import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { safeCompare } from "../lib/auth-guards.js";
import { recordInboundMessage } from "../lib/record-inbound.js";

interface WhatsAppTextMessage {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
}

interface WebhookPayload {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: { messages?: WhatsAppTextMessage[] };
    }>;
  }>;
}

// Meta WhatsApp Cloud API webhook (CORE.md §2 amendment — hosted here
// because the backend is the publicly deployed service).
export async function webhookRoutes(app: FastifyInstance) {
  // Scoped to this plugin: keep the raw JSON bytes so the HMAC signature
  // can be computed over exactly what Meta sent, not a re-serialization.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  // Verification handshake: Meta calls this once when the callback URL is
  // saved in the developer console — echo hub.challenge as plain text iff
  // hub.verify_token matches WHATSAPP_VERIFY_TOKEN.
  app.get("/webhook", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!expected) {
      app.log.warn("GET /webhook called but WHATSAPP_VERIFY_TOKEN is not set");
      return reply.code(403).send();
    }

    if (mode !== "subscribe" || !token || !challenge || !safeCompare(token, expected)) {
      return reply.code(403).send();
    }

    return reply.type("text/plain").send(challenge);
  });

  // Message delivery. Meta signs each request with the app secret; reject
  // anything unsigned. Always ack 200 for valid payloads (even unknown
  // senders) — non-2xx makes Meta retry and eventually pause the webhook.
  app.post("/webhook", async (request, reply) => {
    const secret = process.env.META_APP_SECRET;
    const signature = request.headers["x-hub-signature-256"];
    const raw = request.body as Buffer;

    if (!secret) {
      app.log.warn("POST /webhook called but META_APP_SECRET is not set");
      return reply.code(401).send();
    }
    if (typeof signature !== "string" || !Buffer.isBuffer(raw)) {
      return reply.code(401).send();
    }
    const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    if (!safeCompare(signature, expected)) {
      return reply.code(401).send();
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return reply.code(400).send();
    }

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        for (const message of change.value?.messages ?? []) {
          if (message.type !== "text" || !message.text?.body || !message.from) continue;
          const phoneE164 = `+${message.from}`;
          try {
            const elder = await recordInboundMessage(phoneE164, message.text.body);
            if (!elder) {
              app.log.info({ phoneE164 }, "webhook message from unregistered number recorded");
            }
          } catch (err) {
            // storage failure must not turn into a non-2xx: Meta would
            // redeliver the whole batch and eventually disable the webhook
            app.log.error({ err, phoneE164 }, "failed to record webhook message");
          }
        }
      }
    }

    return reply.code(200).send();
  });
}
