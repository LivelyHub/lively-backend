import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db } from "../../db/index.js";
import { chairTestResults, exerciseLogs, medications, medicationLogs, elders } from "../../db/schema.js";
import { toUtcDateString } from "../../shared/dates.js";

type Period = "week" | "month";

// Mirrors lively-mobile/lib/api/mocks/computeReport.ts exactly (shape,
// algorithm, and copy) — that's the mobile team's real reference
// implementation, built around this exact PerformanceReport contract.
// Adapted to UTC day boundaries for server-side consistency (the mock
// uses local calendar dates; a server has no meaningful "local").
function rangeDays(period: Period): number {
  return period === "month" ? 30 : 7;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export async function computeReport(elderId: string, period: Period) {
  const days = rangeDays(period);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const queryToExclusive = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const periodWord = period === "week" ? "minggu" : "bulan";

  const [elder] = await db.select().from(elders).where(eq(elders.id, elderId));
  const honorific = elder?.honorific ?? "Eyang";

  const [chairRows, exerciseRows, activeMeds, medLogRows] = await Promise.all([
    db
      .select()
      .from(chairTestResults)
      .where(and(eq(chairTestResults.elderId, elderId), gte(chairTestResults.recordedAt, start), lt(chairTestResults.recordedAt, queryToExclusive)))
      .orderBy(asc(chairTestResults.recordedAt)),
    db
      .select()
      .from(exerciseLogs)
      .where(and(eq(exerciseLogs.elderId, elderId), gte(exerciseLogs.completedAt, start), lt(exerciseLogs.completedAt, queryToExclusive))),
    db.select().from(medications).where(and(eq(medications.elderId, elderId), eq(medications.active, true))),
    db
      .select()
      .from(medicationLogs)
      .where(and(eq(medicationLogs.elderId, elderId), gte(medicationLogs.takenAt, start), lt(medicationLogs.takenAt, queryToExclusive))),
  ]);

  const exerciseDays = new Set(exerciseRows.map((r) => toUtcDateString(r.completedAt)));
  const medDays = new Set(medLogRows.map((r) => toUtcDateString(r.takenAt)));
  const chairDays = chairRows.map((r) => toUtcDateString(r.recordedAt));
  const activeDays = new Set([...exerciseDays, ...medDays, ...chairDays]);

  // Medication adherence: a med only counts toward "scheduled" on days on
  // or after it was created, and a day's taken count is capped at that
  // day's scheduled count (a duplicate/extra log never inflates the pct).
  function scheduledOn(dayStart: Date): number {
    const nextDayStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    let count = 0;
    for (const med of activeMeds) {
      if (med.createdAt.getTime() < nextDayStart.getTime()) count += med.scheduleTimes.length;
    }
    return count;
  }
  const logsByDay = new Map<string, number>();
  for (const log of medLogRows) {
    const key = toUtcDateString(log.takenAt);
    logsByDay.set(key, (logsByDay.get(key) ?? 0) + 1);
  }
  let taken = 0;
  let scheduled = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const sched = scheduledOn(d);
    taken += Math.min(logsByDay.get(toUtcDateString(d)) ?? 0, sched);
    scheduled += sched;
  }

  const consistencyPct = pct(activeDays.size, days);
  const exerciseCompletionPct = pct(exerciseDays.size, days);
  const medicationAdherencePct = pct(taken, scheduled);

  const chairFirst = chairRows.length > 0 ? chairRows[0]!.reps : null;
  const chairLatest = chairRows.length > 0 ? chairRows[chairRows.length - 1]!.reps : null;
  const chairTestDelta = chairRows.length >= 2 && chairFirst !== null && chairLatest !== null ? chairLatest - chairFirst : null;

  const hasData = activeDays.size > 0;

  let headline: string;
  if (!hasData) {
    headline = `Belum cukup data ${periodWord} ini. Ringkasan akan muncul setelah ${honorific} mulai beraktivitas.`;
  } else if (consistencyPct >= 80) {
    headline = `${honorific} sangat konsisten ${periodWord} ini, aktif ${activeDays.size} dari ${days} hari.`;
  } else if (consistencyPct >= 50) {
    headline = `${honorific} cukup aktif ${periodWord} ini, ${activeDays.size} dari ${days} hari.`;
  } else {
    headline = `${honorific} sudah mulai bergerak ${periodWord} ini. Setiap hari aktif itu berarti.`;
  }

  const highlights: string[] = [];
  if (chairTestDelta !== null && chairTestDelta > 0) {
    highlights.push(`Tes kursi naik dari ${chairFirst} ke ${chairLatest} kali, kekuatan kaki membaik.`);
  }
  if (exerciseCompletionPct >= 60) {
    highlights.push(`Rajin latihan kursi, ${exerciseDays.size} dari ${days} hari.`);
  }
  if (scheduled > 0 && medicationAdherencePct >= 85) {
    highlights.push(`Obat diminum teratur (${medicationAdherencePct}%).`);
  }
  if (highlights.length === 0 && hasData) {
    highlights.push(`${honorific} tetap terhubung dengan pendamping setiap hari.`);
  }

  const areasNeedingSupport: string[] = [];
  if (scheduled > 0 && medicationAdherencePct < 70) {
    areasNeedingSupport.push("Beberapa dosis obat terlewat. Pengingat tambahan mungkin membantu.");
  }
  if (exerciseCompletionPct < 40 && hasData) {
    areasNeedingSupport.push("Latihan kursi sempat jarang. Tidak apa-apa, pelan-pelan saja.");
  }
  if (chairTestDelta !== null && chairTestDelta < 0) {
    areasNeedingSupport.push("Tes kursi sedikit menurun. Wajar naik-turun, tetap semangat menemani.");
  }

  return {
    period,
    range_start: toUtcDateString(start),
    range_end: toUtcDateString(today),
    has_data: hasData,
    headline,
    consistency_pct: consistencyPct,
    exercise_completion_pct: exerciseCompletionPct,
    medication_adherence_pct: medicationAdherencePct,
    chair_test_latest: chairLatest,
    chair_test_delta: chairTestDelta,
    highlights,
    areas_needing_support: areasNeedingSupport,
  };
}
