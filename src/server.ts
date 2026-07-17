import "dotenv/config";
import Fastify, { type FastifyError } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { authRoutes } from "./modules/auth/routes.js";
import { elderRoutes } from "./modules/elders/routes.js";
import { conversationRoutes } from "./modules/conversations/routes.js";
import { assessmentRoutes } from "./modules/assessments/routes.js";
import { progressRoutes } from "./modules/progress/routes.js";
import { medicationRoutes } from "./modules/medications/routes.js";
import { alertRoutes } from "./modules/alerts/routes.js";
import { familyMemberRoutes } from "./modules/family-members/routes.js";
import { titipanRoutes } from "./modules/titipan/routes.js";
import { reportRoutes } from "./modules/report/routes.js";
import { webhookRoutes } from "./modules/webhook/routes.js";
import { uploadRoutes } from "./modules/uploads/routes.js";
import { UPLOAD_DIR } from "./shared/uploads.js";
import type { HttpError } from "./shared/http-errors.js";
import { mkdir } from "node:fs/promises";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
  },
});

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

  if (error.code === "FST_TOO_MANY_REQUESTS") {
    reply.status(429).send({
      error: { code: "RATE_LIMITED", message: "Too many requests, try again shortly" },
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
  app.log.error(
    `Missing required env vars: ${missingEnvVars.join(", ")} — refusing to start`,
  );
  process.exit(1);
}

// Open CORS (SPEC §6 explicitly waives abuse protection at hackathon
// scope — this is a two-client trusted system, not public-internet-facing).
// origin: true reflects the request's Origin back rather than a literal
// "*", which is what Expo Go's dev client and the deployed app both need.
await app.register(fastifyCors, { origin: true });
await app.register(fastifyJwt, { secret: process.env.JWT_SECRET! });
// Global default is loose (this is still a two-client trusted system); only
// /auth/login and /auth/register override it tighter (see modules/auth/routes.ts)
// since those are the actual brute-force/credential-stuffing surface.
await app.register(fastifyRateLimit, { max: 300, timeWindow: "1 minute" });
await app.register(fastifyMultipart);
await mkdir(UPLOAD_DIR, { recursive: true });
await app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: "/uploads/" });
await app.register(authRoutes);
await app.register(elderRoutes);
await app.register(conversationRoutes);
await app.register(assessmentRoutes);
await app.register(progressRoutes);
await app.register(medicationRoutes);
await app.register(alertRoutes);
await app.register(familyMemberRoutes);
await app.register(titipanRoutes);
await app.register(reportRoutes);
await app.register(webhookRoutes);
await app.register(uploadRoutes);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
