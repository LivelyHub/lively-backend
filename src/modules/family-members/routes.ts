import { eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { familyMembers } from "../../db/schema.js";
import { requireFamily } from "../../shared/auth-guards.js";
import { HttpError, parseBody } from "../../shared/http-errors.js";
import { serializeFamilyMember } from "./service.js";

const patchMeSchema = z.object({
  push_token: z.string().min(1).max(500).optional(),
  name: z.string().trim().min(1).max(200).optional(),
});

export async function familyMemberRoutes(app: FastifyInstance) {
  app.get("/family-members/me", { preHandler: requireFamily }, async (request) => {
    const [row] = await db.select().from(familyMembers).where(eq(familyMembers.id, request.familyMemberId!));
    if (!row) {
      throw new HttpError(404, "NOT_FOUND", "Family member not found");
    }
    return serializeFamilyMember(row);
  });

  app.patch("/family-members/me", { preHandler: requireFamily }, async (request) => {
    const body = parseBody(patchMeSchema, request.body);
    const [existing] = await db.select().from(familyMembers).where(eq(familyMembers.id, request.familyMemberId!));
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Family member not found");
    }

    const [updated] = await db
      .update(familyMembers)
      .set({
        pushToken: body.push_token ?? existing.pushToken,
        name: body.name ?? existing.name,
      })
      .where(eq(familyMembers.id, request.familyMemberId!))
      .returning();

    return serializeFamilyMember(updated!);
  });
}
