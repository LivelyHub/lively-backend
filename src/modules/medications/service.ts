import type { medications } from "../../db/schema.js";

type MedicationRow = typeof medications.$inferSelect;

// snake_case to match lively-mobile/lib/api/types.ts's Medication contract.
// Shared by modules/medications/routes.ts and modules/progress/service.ts (the
// raw medications array in GET /elders/:id/progress uses the identical shape).
export function serializeMedication(row: MedicationRow) {
  return {
    id: row.id,
    elder_id: row.elderId,
    name: row.name,
    dosage: row.dosage,
    schedule_times: row.scheduleTimes.map((t) => t.slice(0, 5)),
    active: row.active,
    created_at: row.createdAt,
  };
}

export type SlotStatus = "taken" | "unconfirmed" | "upcoming";

// Same trailing-N heuristic as progress/service.ts's unconfirmed_today: medication_logs
// has no slot column, so a partial day can't say *which* dose was confirmed.
// This marks the earliest `logsToday` schedule_times as taken (sorted
// ascending), then splits the rest into unconfirmed (already due) vs
// upcoming by comparing against the current UTC time-of-day — exact for the
// common single-dose-per-day case, approximate for multi-dose medications.
export function computeSlots(
  scheduleTimes: string[],
  logsToday: number,
  nowTimeOfDay: string,
): { time: string; status: SlotStatus }[] {
  const sorted = scheduleTimes.map((t) => t.slice(0, 5)).sort();
  return sorted.map((time, i) => {
    if (i < logsToday) return { time, status: "taken" as const };
    return { time, status: (time <= nowTimeOfDay ? "unconfirmed" : "upcoming") as SlotStatus };
  });
}
