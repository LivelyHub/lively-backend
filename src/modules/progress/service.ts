import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { chairTestResults, exerciseLogs, medications, medicationLogs } from "../../db/schema.js";
import { toUtcDateString } from "../../shared/dates.js";
import { serializeMedication } from "../medications/service.js";

function lastNDays(n: number): string[] {
  const days: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    days.push(toUtcDateString(new Date(today.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return days;
}

// Calendar week (Monday-Sunday, UTC), distinct from the rolling 30-day
// windows used elsewhere in this file — mobile's day-dot streak row wants a
// fixed week grid with real "future" days when today isn't Sunday yet,
// which a trailing window (always ending today) can never produce.
function currentWeekDates(): string[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysSinceMonday = (today.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
  const monday = new Date(today.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    dates.push(toUtcDateString(new Date(monday.getTime() + i * 24 * 60 * 60 * 1000)));
  }
  return dates;
}

// Consecutive-day streak ending today, with a one-day grace: if today has
// no activity yet, the streak is still counted from yesterday backward
// rather than zeroing out just because today isn't over.
function computeStreak(dates: Set<string>): number {
  let streak = 0;
  let cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  if (!dates.has(toUtcDateString(cursor))) {
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  while (dates.has(toUtcDateString(cursor))) {
    streak++;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  return streak;
}

export async function computeProgress(elderId: string) {
  const [chairRows, exerciseRows, allMedicationRows, medicationLogRows] = await Promise.all([
    db
      .select()
      .from(chairTestResults)
      .where(eq(chairTestResults.elderId, elderId))
      .orderBy(desc(chairTestResults.recordedAt))
      .limit(20),
    db.select().from(exerciseLogs).where(eq(exerciseLogs.elderId, elderId)),
    // All medications, active and inactive — mobile's Home glance filters
    // by .active client-side (components/home/glance.ts), so the raw array
    // needs to carry both, not just the active subset.
    db.select().from(medications).where(eq(medications.elderId, elderId)),
    db.select().from(medicationLogs).where(eq(medicationLogs.elderId, elderId)),
  ]);

  const activeMedicationRows = allMedicationRows.filter((m) => m.active);

  const chairTests = chairRows
    .slice()
    .reverse()
    .map((r) => ({ reps: r.reps, recorded_at: r.recordedAt }));
  const latestReps = chairRows.length > 0 ? chairRows[0]!.reps : 0;

  const exerciseDates = new Set(exerciseRows.map((r) => toUtcDateString(r.completedAt)));
  const currentStreakDays = computeStreak(exerciseDates);
  const todayStr = toUtcDateString(new Date());
  const thisWeek = currentWeekDates().map((date) => ({
    date,
    status: date > todayStr ? ("future" as const) : exerciseDates.has(date) ? ("done" as const) : ("missed" as const),
  }));
  const last30Days = lastNDays(30);
  const exerciseHistory = last30Days.map((d) => ({ date: d, completed: exerciseDates.has(d) }));

  const scheduledPerDay = activeMedicationRows.reduce((sum, m) => sum + m.scheduleTimes.length, 0);
  const last7dScheduled = scheduledPerDay * 7;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const last7dTaken = medicationLogRows.filter((l) => l.takenAt >= sevenDaysAgo).length;
  const medicationAdherencePct = last7dScheduled > 0 ? Math.round((last7dTaken / last7dScheduled) * 100) : 0;

  const unconfirmedToday: string[] = [];
  for (const med of activeMedicationRows) {
    const logsToday = medicationLogRows.filter(
      (l) => l.medicationId === med.id && toUtcDateString(l.takenAt) === todayStr,
    ).length;
    // medication_logs has no slot column, so a partial day (e.g. 1 of 2
    // doses confirmed) can't say *which* slot is still open — this takes
    // the trailing N-confirmed schedule_times as a deterministic stand-in.
    const unconfirmedCount = Math.max(0, med.scheduleTimes.length - logsToday);
    for (let i = 0; i < unconfirmedCount; i++) {
      const time = med.scheduleTimes[med.scheduleTimes.length - unconfirmedCount + i]!.slice(0, 5);
      unconfirmedToday.push(`${med.name} ${time}`);
    }
  }

  const medicationAdherenceTrend = last30Days.map((date) => {
    const taken = medicationLogRows.filter((l) => toUtcDateString(l.takenAt) === date).length;
    return { date, taken, scheduled: scheduledPerDay };
  });

  const chairScore = Math.min(100, (latestReps / 15) * 100);
  const exerciseScore = Math.min(100, (currentStreakDays / 7) * 100);
  const scores = [chairScore, exerciseScore];
  // No active medications at all -> exclude the medication component from
  // the average instead of dividing by zero or unfairly penalizing an
  // elder with nothing prescribed.
  if (last7dScheduled > 0) {
    scores.push(Math.min(100, (last7dTaken / last7dScheduled) * 100));
  }
  const overallProgressPct = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  const chairDates = new Set(chairRows.map((r) => toUtcDateString(r.recordedAt)));
  const medDates = new Set(medicationLogRows.map((r) => toUtcDateString(r.takenAt)));
  const engagementDates = new Set([...exerciseDates, ...chairDates, ...medDates]);
  const engagementStreakDays = computeStreak(engagementDates);

  return {
    // Raw arrays, snake_case, also consumed directly by mobile's Home
    // "today at a glance" rows (components/home/glance.ts) — kept verbatim
    // alongside the computed fields below, not replaced by them.
    chair_test_results: chairRows.map((r) => ({
      id: r.id,
      elder_id: r.elderId,
      reps: r.reps,
      recorded_at: r.recordedAt,
      source: r.source,
    })),
    exercise_logs: exerciseRows.map((r) => ({
      id: r.id,
      elder_id: r.elderId,
      completed_at: r.completedAt,
      method: r.method,
    })),
    medications: allMedicationRows.map(serializeMedication),
    medication_logs: medicationLogRows.map((l) => ({
      id: l.id,
      medication_id: l.medicationId,
      elder_id: l.elderId,
      taken_at: l.takenAt,
      method: l.method,
    })),

    overall_progress_pct: overallProgressPct,
    engagement_streak_days: engagementStreakDays,
    chair_tests: chairTests,
    exercise: { current_streak_days: currentStreakDays, this_week: thisWeek, total: exerciseRows.length },
    exercise_history: exerciseHistory,
    medication_adherence: {
      last7d_taken: last7dTaken,
      last7d_scheduled: last7dScheduled,
      pct: medicationAdherencePct,
      unconfirmed_today: unconfirmedToday,
    },
    medication_adherence_trend: medicationAdherenceTrend,
  };
}
