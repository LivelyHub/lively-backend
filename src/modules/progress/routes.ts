import type { FastifyInstance } from "fastify";
import { requireFamily } from "../../shared/auth-guards.js";
import { getOwnedElder } from "../../shared/owned-elder.js";
import { computeProgress } from "./service.js";

export async function progressRoutes(app: FastifyInstance) {
  app.get("/elders/:id/progress", { preHandler: requireFamily }, async (request) => {
    const { id } = request.params as { id: string };
    await getOwnedElder(request.familyMemberId!, id);
    return computeProgress(id);
  });
}
