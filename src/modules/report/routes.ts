import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requireFamily } from "../../shared/auth-guards.js";
import { getOwnedElder } from "../../shared/owned-elder.js";
import { parseQuery } from "../../shared/http-errors.js";
import { computeReport } from "./service.js";

const reportQuerySchema = z.object({
  period: z.enum(["week", "month"]).default("week"),
});

export async function reportRoutes(app: FastifyInstance) {
  app.get("/elders/:id/report", { preHandler: requireFamily }, async (request) => {
    const { id } = request.params as { id: string };
    await getOwnedElder(request.familyMemberId!, id);
    const query = parseQuery(reportQuerySchema, request.query);
    return computeReport(id, query.period);
  });
}
