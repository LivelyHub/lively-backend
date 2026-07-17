import type { FastifyBaseLogger } from "fastify";
import { db } from "../db/index.js";
import { conversations, type elders } from "../db/schema.js";
import { sendWhatsAppText, whatsappSendConfigured } from "./whatsapp.js";

type ElderRow = typeof elders.$inferSelect;

// lively-bot's POST /reply contract (src/server.ts on that side): the
// companion persona is no longer sent per-call — it's registered once via
// POST /soul (see shared/bot-sync.ts, called from elders/routes.ts) and
// persists bot-side. Only the per-turn text and the freeform personalize
// blob travel with every reply.
interface BotReplyResponse {
  reply?: string;
}

async function fetchBotReply(elder: ElderRow, text: string): Promise<string> {
  const baseUrl = process.env.BOT_REPLY_URL;
  if (!baseUrl) throw new Error("BOT_REPLY_URL not set");

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/reply`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.BOT_SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      elderId: elder.id,
      text,
      personalize: elder.personalize ?? null,
    }),
    // LLM + tool round trips are slow; well past Meta's ack window, which
    // is why callers must never block the webhook response on this.
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`lively-bot /reply failed (${res.status})`);
  }
  const payload = (await res.json()) as BotReplyResponse;
  if (!payload.reply) {
    throw new Error("lively-bot /reply returned no reply text");
  }
  return payload.reply;
}

// Full inbound→AI→WhatsApp round trip for one elder message: ask
// lively-bot for the companion's answer, send it back over the Cloud API,
// and log it as an outbound conversation row (same shape POST /bot/outbound
// writes). Runs detached from the webhook request — errors are logged,
// never thrown, so a bot/LLM outage can't affect webhook delivery.
export async function deliverCompanionReply(
  elder: ElderRow,
  text: string,
  log: FastifyBaseLogger,
): Promise<void> {
  if (!process.env.BOT_REPLY_URL || !whatsappSendConfigured()) {
    log.warn(
      { elderId: elder.id },
      "companion reply skipped — BOT_REPLY_URL / WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not fully configured",
    );
    return;
  }

  try {
    const answer = await fetchBotReply(elder, text);
    await sendWhatsAppText(elder.phoneE164, answer);
    // Log only after a successful send so the Chat Monitor never shows a
    // message the elder didn't actually receive.
    await db.insert(conversations).values({ elderId: elder.id, direction: "out", body: answer });
  } catch (err) {
    log.error({ err, elderId: elder.id }, "failed to deliver companion reply");
  }
}
