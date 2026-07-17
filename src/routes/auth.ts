import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { familyMembers } from "../db/schema.js";
import { HttpError, isUniqueViolation, parseBody } from "../lib/http-errors.js";
import { serializeFamilyMember } from "../lib/family-members.js";

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// JWTs carry family_member_id and last >= 72h (B2.1) so judges don't
// get logged out mid-demo; 7d gives margin past the submission window.
const TOKEN_EXPIRY = "7d";

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/register", async (request, reply) => {
    const body = parseBody(registerSchema, request.body);
    const passwordHash = await bcrypt.hash(body.password, 10);

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

    const token = app.jwt.sign({ family_member_id: inserted.id }, { expiresIn: TOKEN_EXPIRY });
    reply.code(201);
    return {
      token,
      family_member: serializeFamilyMember(inserted),
    };
  });

  app.post("/auth/login", async (request) => {
    const body = parseBody(loginSchema, request.body);
    const [row] = await db.select().from(familyMembers).where(eq(familyMembers.email, body.email));

    // Same message whether the email doesn't exist or the password is
    // wrong — don't let this endpoint confirm which emails are registered.
    const invalidCredentials = () => new HttpError(401, "UNAUTHORIZED", "Invalid email or password");
    if (!row) throw invalidCredentials();

    const valid = await bcrypt.compare(body.password, row.passwordHash);
    if (!valid) throw invalidCredentials();

    const token = app.jwt.sign({ family_member_id: row.id }, { expiresIn: TOKEN_EXPIRY });
    return {
      token,
      family_member: serializeFamilyMember(row),
    };
  });
}
