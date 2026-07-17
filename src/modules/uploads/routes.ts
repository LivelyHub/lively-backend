import type { FastifyInstance } from "fastify";
import { requireBot } from "../../shared/auth-guards.js";
import { saveUploadedPhoto } from "../../shared/uploads.js";
import { HttpError } from "../../shared/http-errors.js";

// Reconstructed: server.ts referenced this module but it was never
// committed with the domain-module refactor. Contract recovered from the
// consumers — assessments/medications routes document "photo_url ...
// from a prior POST /uploads/photo", and both photo-consuming writes
// (/exercise-logs, /medication-logs) are requireBot, so the upload
// endpoint is bot-guarded too. Storage/validation all live in
// shared/uploads.ts; this route is just the multipart entry point.
export async function uploadRoutes(app: FastifyInstance) {
  app.post("/uploads/photo", { preHandler: requireBot }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      throw new HttpError(400, "VALIDATION", "A multipart file field is required", {
        photo: "Missing file",
      });
    }
    const url = await saveUploadedPhoto(file);
    return reply.code(201).send({ url });
  });
}
