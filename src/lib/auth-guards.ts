import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { HttpError } from "./http-errors.js";

declare module "fastify" {
  interface FastifyRequest {
    familyMemberId?: string;
  }
}

export async function requireFamily(request: FastifyRequest): Promise<void> {
  try {
    const decoded = await request.jwtVerify<{ family_member_id: string }>();
    request.familyMemberId = decoded.family_member_id;
  } catch {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid authorization token");
  }
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
