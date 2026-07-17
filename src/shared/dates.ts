// All date-bucketing across this API uses UTC calendar days, not each
// elder's local Indonesian timezone (WIB/WITA/WIT) — the schema has no
// per-elder timezone column and none was requested. Deliberate
// simplification, applied consistently everywhere a "day" matters.

export function utcDayRange(d: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function toUtcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function utcTimeOfDay(d: Date): string {
  return d.toISOString().slice(11, 16);
}
