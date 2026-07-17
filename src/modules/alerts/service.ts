import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../../db/index.js";
import { elders, alerts } from "../../db/schema.js";
import { sendAlertPush } from "./push.js";

export const ALERT_TYPES = [
  "missed_days",
  "pain_mention",
  "dizziness_mention",
  "medication_missed",
  "no_response",
  "emergency",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;

type AlertRow = typeof alerts.$inferSelect;

// The B7.1 path: insert with 30-min duplicate suppression + fire-and-forget
// push. Shared by POST /alerts and B6.3's missed-dose checker — "raise via
// the B7.1 path" means calling this function, not re-implementing it.
export async function raiseAlert(
  elderId: string,
  type: AlertType,
  payload: unknown,
  onPushError: (err: unknown) => void,
): Promise<{ row: AlertRow; wasNew: boolean }> {
  const windowStart = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const [existing] = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.elderId, elderId), eq(alerts.type, type), gte(alerts.createdAt, windowStart)))
    .orderBy(desc(alerts.createdAt))
    .limit(1);

  if (existing) {
    return { row: existing, wasNew: false };
  }

  const [inserted] = await db
    .insert(alerts)
    .values({ elderId, type, payload: payload ?? null })
    .returning();

  const [elder] = await db.select().from(elders).where(eq(elders.id, elderId));
  if (elder) {
    sendAlertPush(elder, type, inserted!.payload).catch(onPushError);
  }

  return { row: inserted!, wasNew: true };
}
