import type { medications } from "../db/schema.js";

type MedicationRow = typeof medications.$inferSelect;

// snake_case to match lively-mobile/lib/api/types.ts's Medication contract.
// Shared by routes/medications.ts and lib/progress.ts (the raw medications
// array in GET /elders/:id/progress uses the identical shape).
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
