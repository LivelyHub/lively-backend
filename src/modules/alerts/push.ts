import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { familyMembers, elders } from "../../db/schema.js";

type AlertType =
  | "missed_days"
  | "pain_mention"
  | "dizziness_mention"
  | "medication_missed"
  | "no_response"
  | "emergency";

// Tiers and copy register per lively-mobile/docs/UI-UX-GUIDELINES.md §5.
const URGENT_TYPES = new Set<AlertType>(["emergency", "pain_mention", "dizziness_mention"]);

function quoteFromPayload(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "quote" in payload) {
    const quote = (payload as { quote: unknown }).quote;
    return typeof quote === "string" ? quote : undefined;
  }
  return undefined;
}

function buildCopy(type: AlertType, honorific: string, payload: unknown): { title: string; body: string } {
  const quote = quoteFromPayload(payload);
  switch (type) {
    case "emergency":
      return { title: `Darurat — ${honorific}`, body: quote ?? `${honorific} butuh bantuan segera — lihat pesannya.` };
    case "pain_mention":
      return { title: honorific, body: quote ? `${honorific} menyebut nyeri — lihat pesannya: "${quote}"` : `${honorific} menyebut nyeri — lihat pesannya.` };
    case "dizziness_mention":
      return { title: honorific, body: quote ? `${honorific} menyebut pusing — lihat pesannya: "${quote}"` : `${honorific} menyebut pusing — lihat pesannya.` };
    case "medication_missed":
      return { title: honorific, body: `${honorific} melewatkan beberapa dosis obat.` };
    case "no_response":
      return { title: honorific, body: `${honorific} belum membalas hari ini — mungkin layak ditelepon.` };
    case "missed_days":
      return { title: honorific, body: `${honorific} melewatkan latihan beberapa hari.` };
  }
}

type ElderRow = typeof elders.$inferSelect;

// Fan-out targets every family member linked to the elder (CORE.md §6: "no
// hardcoded single recipient"). Written as a query returning a list, not a
// single-row lookup, so it's structurally ready for multi-caregiver support
// — but elders.family_member_id is a single FK today (multi-caregiver is an
// explicit SPEC.md non-goal at MVP), so this currently always resolves to
// at most one row. Not overclaiming fan-out the schema doesn't yet support.
export async function sendAlertPush(elder: ElderRow, type: AlertType, payload: unknown): Promise<void> {
  const recipients = await db.select().from(familyMembers).where(eq(familyMembers.id, elder.familyMemberId));
  const tokens = recipients.map((r) => r.pushToken).filter((t): t is string => Boolean(t));
  if (tokens.length === 0) return;

  const { title, body } = buildCopy(type, elder.honorific, payload);
  const urgent = URGENT_TYPES.has(type);

  const messages = tokens.map((to) => ({
    to,
    title,
    body,
    priority: urgent ? "high" : "default",
    ...(urgent ? { sound: "default" } : {}),
  }));

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    throw new Error(`Expo push failed: ${response.status} ${await response.text()}`);
  }

  // Expo returns 200 even for a dead/invalid token — the actual failure is
  // a per-message "error" ticket inside the body, not the HTTP status. A
  // response.ok check alone would silently swallow exactly the failure
  // case B7.2 asks to have logged (a dead token).
  const result = (await response.json()) as { data?: { status: string; message?: string }[] };
  const errorTickets = (result.data ?? []).filter((ticket) => ticket.status === "error");
  if (errorTickets.length > 0) {
    throw new Error(`Expo push ticket errors: ${errorTickets.map((t) => t.message).join("; ")}`);
  }
}
