import { and, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { elders, medications, medicationLogs } from "../../db/schema.js";
import { requireBot, requireFamily } from "../../shared/auth-guards.js";
import { HttpError, parseBody, parseQuery } from "../../shared/http-errors.js";
import { getOwnedElder } from "../../shared/owned-elder.js";
import { utcDayRange, utcTimeOfDay } from "../../shared/dates.js";
import { checkMissedDoses } from "./missed-doses.js";
import { serializeMedication, computeSlots } from "./service.js";

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

const medicationLogSchema = z
  .object({
    medication_id: z.string().uuid(),
    elder_id: z.string().uuid(),
    method: z.enum(["reply", "emoji", "photo"]),
    taken_at: z.string().datetime().optional(),
    // Points at /uploads/<file> from a prior POST /uploads/photo — required
    // when method is 'photo' so that value isn't claimed with nothing behind it.
    photo_url: z.string().min(1).max(500).optional(),
  })
  .refine((body) => body.method !== "photo" || Boolean(body.photo_url), {
    message: "photo_url is required when method is 'photo'",
    path: ["photo_url"],
  });

type MedicationRow = typeof medications.$inferSelect;

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

  // Idempotency here is per medication per UTC calendar day, not per
  // medication + slot as BACKLOG.md B6.2 originally specs. Slot-level
  // idempotency needs a scheduled_time/slot column on medication_logs,
  // which doesn't exist and CORE.md's schema froze end of Day 1 — adding
  // one now means a contract change lively-bot would need to adopt
  // mid-hackathon. Day-level idempotency is exactly correct for the
  // single-dose-per-day case (the seed data, and likely the demo); it
  // under-confirms a second same-day dose for multi-dose medications.
  // Flagged here and in B6.1/B5.3 rather than silently shipped as if exact.
  app.post("/medication-logs", { preHandler: requireBot }, async (request, reply) => {
    const body = parseBody(medicationLogSchema, request.body);

    const [medication] = await db.select().from(medications).where(eq(medications.id, body.medication_id));
    if (!medication) {
      throw new HttpError(404, "NOT_FOUND", "Medication not found");
    }
    if (medication.elderId !== body.elder_id) {
      throw new HttpError(400, "VALIDATION", "Medication does not belong to this elder", {
        medication_id: "Belongs to a different elder",
      });
    }

    const takenAt = body.taken_at ? new Date(body.taken_at) : new Date();
    const { start, end } = utcDayRange(takenAt);

    const [existing] = await db
      .select()
      .from(medicationLogs)
      .where(
        and(
          eq(medicationLogs.medicationId, medication.id),
          gte(medicationLogs.takenAt, start),
          lt(medicationLogs.takenAt, end),
        ),
      );

    if (existing) {
      return {
        id: existing.id,
        medication_id: existing.medicationId,
        elder_id: existing.elderId,
        method: existing.method,
        taken_at: existing.takenAt,
        photo_url: existing.photoUrl,
      };
    }

    const [inserted] = await db
      .insert(medicationLogs)
      .values({
        medicationId: medication.id,
        elderId: medication.elderId,
        method: body.method,
        takenAt,
        photoUrl: body.photo_url ?? null,
      })
      .returning();

    reply.code(201);
    return {
      id: inserted.id,
      medication_id: inserted.medicationId,
      elder_id: inserted.elderId,
      method: inserted.method,
      taken_at: inserted.takenAt,
      photo_url: inserted.photoUrl,
    };
  });
}
