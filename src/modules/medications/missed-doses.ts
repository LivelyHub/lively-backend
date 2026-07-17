import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { medications, medicationLogs } from "../../db/schema.js";
import { raiseAlert } from "../alerts/service.js";
import { toUtcDateString } from "../../shared/dates.js";

// Defaults per CORE §5 / BACKLOG.md B6.3. "Per-elder-overridable" is noted
// in the story but there's no column to override them with and no product
// requirement specified what an override would look like — shipped as
// fixed constants, not a half-built override mechanism nobody can drive.
const GRACE_MS = 2 * 60 * 60 * 1000;
const CONSECUTIVE_THRESHOLD = 2;
const LOOKBACK_DAYS = 7;

interface Occurrence {
  date: string;
  scheduledAt: Date;
}

function enumerateOccurrences(scheduleTimes: string[], days: number): Occurrence[] {
  const occurrences: Occurrence[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(today.getTime() - d * 24 * 60 * 60 * 1000);
    const dateStr = toUtcDateString(day);
    for (const t of scheduleTimes) {
      const [hh, mm] = t.slice(0, 5).split(":").map(Number);
      occurrences.push({ date: dateStr, scheduledAt: new Date(day.getTime() + hh! * 60 * 60 * 1000 + mm! * 60 * 1000) });
    }
  }
  return occurrences.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

// Triggered lazily on read (GET /elders/:id/medications), not a background
// job — a deliberate choice for hackathon scale (tiny data volume, no
// scheduler infra to stand up for one P1 story), documented rather than
// silently picked.
//
// "2 consecutive missed slots" reuses the same trailing-N-taken heuristic
// as B5.3/B6.1/B6.2: medication_logs has no slot column, so a day's logs
// are matched to that day's earliest scheduled occurrences in chronological
// order. Exact for single-dose-per-day medications (the seed data); an
// approximation for multi-dose ones, same documented limitation as
// everywhere else this heuristic appears.
export async function checkMissedDoses(elderId: string, onPushError: (err: unknown) => void): Promise<void> {
  const activeMeds = await db
    .select()
    .from(medications)
    .where(and(eq(medications.elderId, elderId), eq(medications.active, true)));

  for (const med of activeMeds) {
    const logs = await db.select().from(medicationLogs).where(eq(medicationLogs.medicationId, med.id));
    const logsByDay = new Map<string, number>();
    for (const log of logs) {
      const d = toUtcDateString(log.takenAt);
      logsByDay.set(d, (logsByDay.get(d) ?? 0) + 1);
    }

    const now = new Date();
    const dueOccurrences = enumerateOccurrences(med.scheduleTimes, LOOKBACK_DAYS).filter(
      (o) => o.scheduledAt.getTime() + GRACE_MS <= now.getTime(),
    );
    if (dueOccurrences.length < CONSECUTIVE_THRESHOLD) continue;

    const consumedPerDay = new Map<string, number>();
    const misses: boolean[] = [];
    for (const occ of dueOccurrences) {
      const consumed = consumedPerDay.get(occ.date) ?? 0;
      const dayLogs = logsByDay.get(occ.date) ?? 0;
      const isHit = consumed < dayLogs;
      if (isHit) consumedPerDay.set(occ.date, consumed + 1);
      misses.push(!isHit);
    }

    const lastTwo = misses.slice(-CONSECUTIVE_THRESHOLD);
    const isConsecutiveMiss = lastTwo.length === CONSECUTIVE_THRESHOLD && lastTwo.every(Boolean);
    if (!isConsecutiveMiss) continue;

    await raiseAlert(elderId, "medication_missed", { medication_id: med.id, medication_name: med.name }, onPushError);
  }
}
