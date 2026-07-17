import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { revokedTokens } from "../../db/schema.js";

// JWTs carry family_member_id and last >= 72h (B2.1) so judges don't get
// logged out mid-demo; 7d gives margin past the submission window.
export const TOKEN_EXPIRY = "7d";
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export interface FamilyJwtPayload {
  family_member_id: string;
  jti: string;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// jti lets a single token be individually revoked (logout) without needing
// a session store — see revokedTokens/requireFamily.
export function signFamilyToken(app: FastifyInstance, familyMemberId: string): string {
  return app.jwt.sign({ family_member_id: familyMemberId, jti: randomUUID() }, { expiresIn: TOKEN_EXPIRY });
}

export async function revokeToken(jti: string): Promise<void> {
  await db
    .insert(revokedTokens)
    .values({ jti, expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS) })
    .onConflictDoNothing();
}

export async function isTokenRevoked(jti: string): Promise<boolean> {
  const [row] = await db.select({ jti: revokedTokens.jti }).from(revokedTokens).where(eq(revokedTokens.jti, jti));
  return Boolean(row);
}

// Best-effort cleanup so the table doesn't grow forever — called opportunistically
// from logout rather than run as a cron (no scheduler infra at hackathon scale).
export async function pruneExpiredRevocations(): Promise<void> {
  await db.delete(revokedTokens).where(lt(revokedTokens.expiresAt, new Date()));
}
