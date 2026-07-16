import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { elders, titipanMessages } from "../db/schema.js";
import { requireBot, requireFamily } from "../lib/auth-guards.js";
import { HttpError, parseBody, parseQuery } from "../lib/http-errors.js";
import { getOwnedElder } from "../lib/owned-elder.js";

const uuidSchema = z.string().uuid();

const sendTitipanSchema = z.object({
  body: z.string().trim().min(1).max(500),
});

const queueQuerySchema = z.object({
  elder_id: z.string().uuid(),
});

type TitipanRow = typeof titipanMessages.$inferSelect;

// Documented response shape (BACKLOG.md B8.1) is {id, body, delivered_at} —
// returning the full row is a superset of that, matching how every other
// resource in this API serializes (elders, medications, alerts).
function serializeTitipan(row: TitipanRow) {
  return {
    id: row.id,
    elder_id: row.elderId,
    family_member_id: row.familyMemberId,
    body: row.body,
    delivered_at: row.deliveredAt,
    created_at: row.createdAt,
  };
}

export async function titipanRoutes(app: FastifyInstance) {
  app.post("/elders/:id/titipan", { preHandler: requireFamily }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await getOwnedElder(request.familyMemberId!, id);
    const body = parseBody(sendTitipanSchema, request.body);

    const [inserted] = await db
      .insert(titipanMessages)
      .values({ elderId: id, familyMemberId: request.familyMemberId!, body: body.body })
      .returning();

    reply.code(201);
    return serializeTitipan(inserted!);
  });

  app.get("/bot/titipan-queue", { preHandler: requireBot }, async (request) => {
    const query = parseQuery(queueQuerySchema, request.query);
    const [elder] = await db.select().from(elders).where(eq(elders.id, query.elder_id));
    if (!elder) {
      throw new HttpError(404, "NOT_FOUND", "Elder not found");
    }

    const rows = await db
      .select()
      .from(titipanMessages)
      .where(and(eq(titipanMessages.elderId, query.elder_id), isNull(titipanMessages.deliveredAt)))
      .orderBy(asc(titipanMessages.createdAt));

    return rows.map(serializeTitipan);
  });

  app.patch("/bot/titipan/:id/delivered", { preHandler: requireBot }, async (request) => {
    const { id } = request.params as { id: string };
    if (!uuidSchema.safeParse(id).success) {
      throw new HttpError(404, "NOT_FOUND", "Titipan not found");
    }
    const [existing] = await db.select().from(titipanMessages).where(eq(titipanMessages.id, id));
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Titipan not found");
    }

    if (existing.deliveredAt) {
      return serializeTitipan(existing);
    }

    const [updated] = await db
      .update(titipanMessages)
      .set({ deliveredAt: new Date() })
      .where(eq(titipanMessages.id, id))
      .returning();

    return serializeTitipan(updated!);
  });
}
