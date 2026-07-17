import { and, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { elders, medications, medicationLogs } from "../db/schema.js";
import { requireFamily } from "../lib/auth-guards.js";
import { HttpError, parseBody, parseQuery } from "../lib/http-errors.js";
import { getOwnedElder } from "../lib/owned-elder.js";
import { utcDayRange, utcTimeOfDay } from "../lib/dates.js";
import { checkMissedDoses } from "../lib/missed-doses.js";
import { serializeMedication } from "../lib/medications.js";

const uuidSchema = z.string().uuid();
const HH_MM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const scheduleTimesSchema = z.array(z.string().regex(HH_MM_REGEX, "Must be HH:MM")).min(1).max(10);

const createMedicationSchema = z.object({
  elder_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  dosage: z.string().trim().min(1).max(100),
  schedule_times: scheduleTimesSchema,
  active: z.boolean().default(true),
});

const patchMedicationSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  dosage: z.string().trim().min(1).max(100).optional(),
  schedule_times: scheduleTimesSchema.optional(),
  active: z.boolean().optional(),
});

const listQuerySchema = z.object({
  elder_id: z.string().uuid(),
});

type MedicationRow = typeof medications.$inferSelect;
type SlotStatus = "taken" | "unconfirmed" | "upcoming";

async function getOwnedMedication(familyMemberId: string, medicationId: string): Promise<MedicationRow> {
  if (!uuidSchema.safeParse(medicationId).success) {
    throw new HttpError(404, "NOT_FOUND", "Medication not found");
  }
  const [row] = await db
    .select({ medication: medications, elder: elders })
    .from(medications)
    .innerJoin(elders, eq(medications.elderId, elders.id))
    .where(eq(medications.id, medicationId));
  if (!row || row.elder.familyMemberId !== familyMemberId) {
    throw new HttpError(404, "NOT_FOUND", "Medication not found");
  }
  return row.medication;
}

// Same trailing-N heuristic as progress.ts's unconfirmed_today: medication_logs
// has no slot column, so a partial day can't say *which* dose was confirmed.
// This marks the earliest `logsToday` schedule_times as taken (sorted
// ascending), then splits the rest into unconfirmed (already due) vs
// upcoming by comparing against the current UTC time-of-day — exact for the
// common single-dose-per-day case, approximate for multi-dose medications.
function computeSlots(scheduleTimes: string[], logsToday: number, nowTimeOfDay: string): { time: string; status: SlotStatus }[] {
  const sorted = scheduleTimes.map((t) => t.slice(0, 5)).sort();
  return sorted.map((time, i) => {
    if (i < logsToday) return { time, status: "taken" as const };
    return { time, status: (time <= nowTimeOfDay ? "unconfirmed" : "upcoming") as SlotStatus };
  });
}

export async function medicationRoutes(app: FastifyInstance) {
  app.post("/medications", { preHandler: requireFamily }, async (request, reply) => {
    const body = parseBody(createMedicationSchema, request.body);
    await getOwnedElder(request.familyMemberId!, body.elder_id);

    const [inserted] = await db
      .insert(medications)
      .values({
        elderId: body.elder_id,
        name: body.name,
        dosage: body.dosage,
        scheduleTimes: body.schedule_times,
        active: body.active,
      })
      .returning();

    reply.code(201);
    return serializeMedication(inserted);
  });

  app.patch("/medications/:id", { preHandler: requireFamily }, async (request) => {
    const { id } = request.params as { id: string };
    const existing = await getOwnedMedication(request.familyMemberId!, id);
    const body = parseBody(patchMedicationSchema, request.body);

    const [updated] = await db
      .update(medications)
      .set({
        name: body.name ?? existing.name,
        dosage: body.dosage ?? existing.dosage,
        scheduleTimes: body.schedule_times ?? existing.scheduleTimes,
        active: body.active ?? existing.active,
      })
      .where(eq(medications.id, id))
      .returning();

    return serializeMedication(updated!);
  });

  app.get("/medications", { preHandler: requireFamily }, async (request, reply) => {
    const query = parseQuery(listQuerySchema, request.query);
    await getOwnedElder(request.familyMemberId!, query.elder_id);

    await checkMissedDoses(query.elder_id, (err: unknown) => {
      reply.log.error(err, "push send failed");
    });

    const activeMeds = await db
      .select()
      .from(medications)
      .where(and(eq(medications.elderId, query.elder_id), eq(medications.active, true)));

    const now = new Date();
    const { start, end } = utcDayRange(now);
    const nowTimeOfDay = utcTimeOfDay(now);

    return Promise.all(
      activeMeds.map(async (med) => {
        const logsToday = await db
          .select()
          .from(medicationLogs)
          .where(and(eq(medicationLogs.medicationId, med.id), gte(medicationLogs.takenAt, start), lt(medicationLogs.takenAt, end)));

        return {
          ...serializeMedication(med),
          slots: computeSlots(med.scheduleTimes, logsToday.length, nowTimeOfDay),
        };
      }),
    );
  });
}
