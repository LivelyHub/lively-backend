import "dotenv/config";
import Fastify, { type FastifyError } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCors from "@fastify/cors";
import { sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { authRoutes } from "./routes/auth.js";
import { elderRoutes } from "./routes/elders.js";
import { conversationRoutes } from "./routes/conversations.js";
import { assessmentRoutes } from "./routes/assessments.js";
import { progressRoutes } from "./routes/progress.js";
import { medicationRoutes } from "./routes/medications.js";
import { medicationLogRoutes } from "./routes/medication-logs.js";
import { alertRoutes } from "./routes/alerts.js";
import { familyMemberRoutes } from "./routes/family-members.js";
import { titipanRoutes } from "./routes/titipan.js";
import { reportRoutes } from "./routes/report.js";
import { webhookRoutes } from "./routes/webhook.js";
import type { HttpError } from "./lib/http-errors.js";

const app = Fastify({ logger: true });

app.setErrorHandler((error: FastifyError | HttpError, _request, reply) => {
  app.log.error(error);

  // Fastify's own body-parsing errors (malformed JSON, empty body, wrong
  // content-type, oversized payload) bypass our zod validation layer
  // entirely and would otherwise leak internal FST_ERR_CTP_* codes instead
  // of the standardized VALIDATION shape B9.1 requires. Normalized here,
  // once, rather than special-cased in every route.
  if (typeof error.code === "string" && error.code.startsWith("FST_ERR_CTP_")) {
    reply.status(400).send({
      error: { code: "VALIDATION", message: "Invalid request body" },
    });
    return;
  }

  const statusCode = error.statusCode ?? 500;
  const fields = "fields" in error ? error.fields : undefined;
  reply.status(statusCode).send({
    error: {
      code: error.code ?? "INTERNAL_ERROR",
      message: statusCode >= 500 ? "Internal server error" : error.message,
      ...(fields ? { fields } : {}),
    },
  });
});

app.setNotFoundHandler((_request, reply) => {
  reply.status(404).send({
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
    },
  });
});

app.get("/health", async (_request, reply) => {
  try {
    await db.execute(sql`SELECT 1`);
    return { status: "ok", db: "connected" };
  } catch (err) {
    app.log.error(err);
    reply.status(200);
    return { status: "ok", db: "down" };
  }
});

const port = Number(process.env.PORT ?? 3000);

const requiredEnvVars = ["DATABASE_URL", "JWT_SECRET", "BOT_SERVICE_KEY"];
const missingEnvVars = requiredEnvVars.filter((name) => !process.env[name]);
if (missingEnvVars.length > 0) {
  app.log.error(`Missing required env vars: ${missingEnvVars.join(", ")} — refusing to start`);
  process.exit(1);
}

// Open CORS (SPEC §6 explicitly waives abuse protection at hackathon
// scope — this is a two-client trusted system, not public-internet-facing).
// origin: true reflects the request's Origin back rather than a literal
// "*", which is what Expo Go's dev client and the deployed app both need.
await app.register(fastifyCors, { origin: true });
await app.register(fastifyJwt, { secret: process.env.JWT_SECRET! });
await app.register(authRoutes);
await app.register(elderRoutes);
await app.register(conversationRoutes);
await app.register(assessmentRoutes);
await app.register(progressRoutes);
await app.register(medicationRoutes);
await app.register(medicationLogRoutes);
await app.register(alertRoutes);
await app.register(familyMemberRoutes);
await app.register(titipanRoutes);
await app.register(reportRoutes);
await app.register(webhookRoutes);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
