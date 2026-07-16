import { eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { familyMembers } from "../db/schema.js";
import { requireFamily } from "../lib/auth-guards.js";
import { parseBody } from "../lib/http-errors.js";

const patchMeSchema = z.object({
  push_token: z.string().min(1).max(500),
});

export async function familyMemberRoutes(app: FastifyInstance) {
  app.patch("/family-members/me", { preHandler: requireFamily }, async (request) => {
    const body = parseBody(patchMeSchema, request.body);
    const [updated] = await db
      .update(familyMembers)
      .set({ pushToken: body.push_token })
      .where(eq(familyMembers.id, request.familyMemberId!))
      .returning();

    return { id: updated!.id, email: updated!.email, name: updated!.name, pushToken: updated!.pushToken };
  });
}
