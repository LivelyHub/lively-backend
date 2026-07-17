import { eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { familyMembers } from "../../db/schema.js";
import { HttpError, isUniqueViolation, parseBody } from "../../shared/http-errors.js";
import { requireFamily } from "../../shared/auth-guards.js";
import { serializeFamilyMember } from "../family-members/service.js";
import { hashPassword, verifyPassword, signFamilyToken, revokeToken, pruneExpiredRevocations } from "./service.js";

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  // Rate limits here are stricter than the app default (see server.ts) —
  // brute-force/credential-stuffing targets, unlike the rest of the API.
  const loginRateLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

  app.post("/auth/register", { config: loginRateLimit }, async (request, reply) => {
    const body = parseBody(registerSchema, request.body);
    const passwordHash = await hashPassword(body.password);

    let inserted;
    try {
      [inserted] = await db
        .insert(familyMembers)
        .values({ email: body.email, name: body.name, passwordHash })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError(409, "CONFLICT", "Email already registered");
      }
      throw err;
    }

    const token = signFamilyToken(app, inserted.id);
    reply.code(201);
    return {
      token,
      family_member: serializeFamilyMember(inserted),
    };
  });

  app.post("/auth/login", { config: loginRateLimit }, async (request) => {
    const body = parseBody(loginSchema, request.body);
    const [row] = await db.select().from(familyMembers).where(eq(familyMembers.email, body.email));

    // Same message whether the email doesn't exist or the password is
    // wrong — don't let this endpoint confirm which emails are registered.
    const invalidCredentials = () => new HttpError(401, "UNAUTHORIZED", "Invalid email or password");
    if (!row) throw invalidCredentials();

    const valid = await verifyPassword(body.password, row.passwordHash);
    if (!valid) throw invalidCredentials();

    const token = signFamilyToken(app, row.id);
    return {
      token,
      family_member: serializeFamilyMember(row),
    };
  });

  app.post("/auth/logout", { preHandler: requireFamily }, async (request, reply) => {
    if (request.tokenJti) {
      await revokeToken(request.tokenJti);
      pruneExpiredRevocations().catch((err: unknown) => app.log.error(err, "revoked-token cleanup failed"));
    }
    reply.code(204);
  });
}
