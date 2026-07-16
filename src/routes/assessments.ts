import { and, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { elders, chairTestResults, exerciseLogs } from "../db/schema.js";
import { requireBot } from "../lib/auth-guards.js";
import { HttpError, parseBody } from "../lib/http-errors.js";

const chairTestSchema = z.object({
  elder_id: z.string().uuid(),
  reps: z.number().int().min(0).max(60),
  recorded_at: z.string().datetime().optional(),
});

const exerciseLogSchema = z.object({
  elder_id: z.string().uuid(),
  method: z.enum(["reply", "emoji", "photo"]),
  completed_at: z.string().datetime().optional(),
});

async function findElder(elderId: string) {
  const [elder] = await db.select().from(elders).where(eq(elders.id, elderId));
  if (!elder) {
    throw new HttpError(404, "NOT_FOUND", "Elder not found");
  }
  return elder;
}

// Calendar-day boundary for "one exercise log per elder per day" (B5.2).
// Uses UTC day, not each elder's local Indonesian timezone (WIB/WITA/WIT)
// — the schema has no per-elder timezone column and none was requested,
// so this is a deliberate simplification, not an oversight.
function utcDayRange(d: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export async function assessmentRoutes(app: FastifyInstance) {
  app.post("/assessments/chair-test", { preHandler: requireBot }, async (request, reply) => {
    const body = parseBody(chairTestSchema, request.body);
    const elder = await findElder(body.elder_id);

    const [inserted] = await db
      .insert(chairTestResults)
      .values({
        elderId: elder.id,
        reps: body.reps,
        source: "chat",
        ...(body.recorded_at ? { recordedAt: new Date(body.recorded_at) } : {}),
      })
      .returning();

    reply.code(201);
    return {
      id: inserted.id,
      elder_id: inserted.elderId,
      reps: inserted.reps,
      recorded_at: inserted.recordedAt,
      source: inserted.source,
    };
  });

  app.post("/exercise-logs", { preHandler: requireBot }, async (request, reply) => {
    const body = parseBody(exerciseLogSchema, request.body);
    const elder = await findElder(body.elder_id);

    const completedAt = body.completed_at ? new Date(body.completed_at) : new Date();
    const { start, end } = utcDayRange(completedAt);

    const [existing] = await db
      .select()
      .from(exerciseLogs)
      .where(and(eq(exerciseLogs.elderId, elder.id), gte(exerciseLogs.completedAt, start), lt(exerciseLogs.completedAt, end)));

    if (existing) {
      return {
        id: existing.id,
        elder_id: existing.elderId,
        method: existing.method,
        completed_at: existing.completedAt,
      };
    }

    const [inserted] = await db
      .insert(exerciseLogs)
      .values({ elderId: elder.id, method: body.method, completedAt })
      .returning();

    reply.code(201);
    return {
      id: inserted.id,
      elder_id: inserted.elderId,
      method: inserted.method,
      completed_at: inserted.completedAt,
    };
  });
}
