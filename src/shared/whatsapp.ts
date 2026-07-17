// Outbound send via Meta WhatsApp Cloud API (graph.facebook.com). The
// webhook only receives; replies must be pushed through the Graph API
// /messages edge using the phone-number-id + permanent access token from
// the Meta developer console.

const GRAPH_VERSION = process.env.GRAPH_API_VERSION ?? "v23.0";

export function whatsappSendConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export async function sendWhatsAppText(phoneE164: string, body: string): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error("WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set");
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        // Graph API wants the number without the leading "+" we store.
        to: phoneE164.replace(/^\+/, ""),
        type: "text",
        text: { body },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`WhatsApp send failed (${res.status}): ${detail}`);
  }
}

// Pre-approved template send (Meta requires template messages, not free-form
// text, for anything sent outside the 24h customer-service window — e.g. a
// caregiver-alert button offered proactively on registration). Body/button
// text is static and lives in the Meta-approved template itself, so no
// components array is needed here.
export async function sendWhatsAppTemplate(
  phoneE164: string,
  templateName: string,
  languageCode: string,
): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error("WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set");
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phoneE164.replace(/^\+/, ""),
        type: "template",
        template: { name: templateName, language: { code: languageCode } },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`WhatsApp template send failed (${res.status}): ${detail}`);
  }
}
