import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { chairTestResults, exerciseLogs, medications, medicationLogs } from "../db/schema.js";

// All date-bucketing here uses UTC calendar days, not each elder's local
// Indonesian timezone — same simplification as B5.2 (no per-elder
// timezone column exists), applied consistently for streaks and trends.
function toUtcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function lastNDays(n: number): string[] {
  const days: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    days.push(toUtcDateString(new Date(today.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return days;
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
  const [chairRows, exerciseRows, medicationRows, medicationLogRows] = await Promise.all([
    db
      .select()
      .from(chairTestResults)
      .where(eq(chairTestResults.elderId, elderId))
      .orderBy(desc(chairTestResults.recordedAt))
      .limit(20),
    db.select().from(exerciseLogs).where(eq(exerciseLogs.elderId, elderId)),
    db.select().from(medications).where(and(eq(medications.elderId, elderId), eq(medications.active, true))),
    db.select().from(medicationLogs).where(eq(medicationLogs.elderId, elderId)),
  ]);

  const chairTests = chairRows
    .slice()
    .reverse()
    .map((r) => ({ reps: r.reps, recorded_at: r.recordedAt }));
  const latestReps = chairRows.length > 0 ? chairRows[0]!.reps : 0;

  const exerciseDates = new Set(exerciseRows.map((r) => toUtcDateString(r.completedAt)));
  const currentStreakDays = computeStreak(exerciseDates);
  const last7Days = lastNDays(7);
  const thisWeek = last7Days.filter((d) => exerciseDates.has(d));
  const last30Days = lastNDays(30);
  const exerciseHistory = last30Days.map((d) => ({ date: d, completed: exerciseDates.has(d) }));

  const scheduledPerDay = medicationRows.reduce((sum, m) => sum + m.scheduleTimes.length, 0);
  const last7dScheduled = scheduledPerDay * 7;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const last7dTaken = medicationLogRows.filter((l) => l.takenAt >= sevenDaysAgo).length;

  const todayStr = toUtcDateString(new Date());
  const unconfirmedToday: string[] = [];
  for (const med of medicationRows) {
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
    overall_progress_pct: overallProgressPct,
    engagement_streak_days: engagementStreakDays,
    chair_tests: chairTests,
    exercise: { current_streak_days: currentStreakDays, this_week: thisWeek, total: exerciseRows.length },
    exercise_history: exerciseHistory,
    medication_adherence: {
      last7d_taken: last7dTaken,
      last7d_scheduled: last7dScheduled,
      unconfirmed_today: unconfirmedToday,
    },
    medication_adherence_trend: medicationAdherenceTrend,
  };
}
