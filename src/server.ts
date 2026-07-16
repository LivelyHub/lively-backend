import "dotenv/config";
import Fastify, { type FastifyError } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "./db/index.js";

const app = Fastify({ logger: true });

app.setErrorHandler((error: FastifyError, _request, reply) => {
  app.log.error(error);
  const statusCode = error.statusCode ?? 500;
  reply.status(statusCode).send({
    error: {
      code: error.code ?? "INTERNAL_ERROR",
      message: statusCode >= 500 ? "Internal server error" : error.message,
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

if (!process.env.DATABASE_URL) {
  app.log.error("DATABASE_URL is not set — refusing to start");
  process.exit(1);
}

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
