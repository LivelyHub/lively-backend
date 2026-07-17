import type { FastifyBaseLogger } from "fastify";
import { db } from "../../db/index.js";
import { conversations, type elders, type companions } from "../../db/schema.js";
import { sendWhatsAppText, whatsappSendConfigured } from "../../shared/whatsapp.js";

type ElderRow = typeof elders.$inferSelect;
type CompanionRow = typeof companions.$inferSelect;

// Fired once from POST /elders on successful insert (see routes.ts) — never
// on PATCH, and never re-fires on a retried create: elders.phone_e164 is
// unique, so a retry throws 409 before this is reached (idempotency comes
// free from that constraint, no separate dedup needed).
//
// Fire-and-forget, same pattern as deliverCompanionReply/scheduler.ts: the
// caller must not block POST /elders's response on a WhatsApp round trip,
// and a send failure here must not fail elder creation.
export function sendElderIntroMessage(elder: ElderRow, companion: CompanionRow, log: FastifyBaseLogger): void {
  if (!whatsappSendConfigured()) {
    log.warn({ elderId: elder.id }, "elder intro message skipped — WhatsApp send not configured");
    return;
  }

  const body = `Halo, ${elder.honorific}! Saya ${companion.displayName}, teman ngobrol yang akan menemani ${elder.honorific} sehari-hari lewat WhatsApp. Senang bisa kenalan!`;

  (async () => {
    try {
      await sendWhatsAppText(elder.phoneE164, body);
      await db.insert(conversations).values({ elderId: elder.id, direction: "out", body });
    } catch (err) {
      log.error({ err, elderId: elder.id }, "failed to send elder intro message");
    }
  })();
}
