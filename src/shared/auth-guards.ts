import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { revokedTokens } from "../db/schema.js";
import { HttpError } from "./http-errors.js";

declare module "fastify" {
  interface FastifyRequest {
    familyMemberId?: string;
    tokenJti?: string;
  }
}

interface FamilyTokenPayload {
  family_member_id: string;
  jti?: string;
}

export async function requireFamily(request: FastifyRequest): Promise<void> {
  let decoded: FamilyTokenPayload;
  try {
    decoded = await request.jwtVerify<FamilyTokenPayload>();
  } catch {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid authorization token");
  }

  // jti is absent only for tokens signed before logout/revocation shipped;
  // those simply can't be revoked early (they'll still expire normally).
  if (decoded.jti) {
    const [revoked] = await db.select({ jti: revokedTokens.jti }).from(revokedTokens).where(eq(revokedTokens.jti, decoded.jti));
    if (revoked) {
      throw new HttpError(401, "UNAUTHORIZED", "Token has been revoked");
    }
  }

  request.familyMemberId = decoded.family_member_id;
  request.tokenJti = decoded.jti;
}

export function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function requireBot(request: FastifyRequest): Promise<void> {
  const provided = request.headers["x-bot-key"];
  const expected = process.env.BOT_SERVICE_KEY;
  if (!expected || typeof provided !== "string" || !safeCompare(provided, expected)) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid bot key");
  }
}
