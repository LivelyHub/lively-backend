import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { elders, companions, conversations, alerts } from "../db/schema.js";
import { requireFamily } from "../lib/auth-guards.js";
import { HttpError, parseBody } from "../lib/http-errors.js";

const PHONE_E164_REGEX = /^\+[1-9]\d{6,14}$/;
const COMPANION_KEYS = ["mbak_asih", "mas_budi"] as const;
const uuidSchema = z.string().uuid();

const healthFlagsSchema = z.array(z.string().trim().min(1).max(60)).max(20);

const createElderSchema = z.object({
  name: z.string().trim().min(1).max(200),
  honorific: z.string().trim().min(1).max(100),
  phone_e164: z.string().regex(PHONE_E164_REGEX, "Must be E.164 format, e.g. +628123456789"),
  companion_key: z.enum(COMPANION_KEYS),
  health_flags: healthFlagsSchema.default([]),
});

const patchElderSchema = z.object({
  honorific: z.string().trim().min(1).max(100).optional(),
  companion_key: z.enum(COMPANION_KEYS).optional(),
  health_flags: healthFlagsSchema.optional(),
  paused: z.boolean().optional(),
});

type ElderRow = typeof elders.$inferSelect;
type CompanionRow = typeof companions.$inferSelect;

function serializeElder(row: ElderRow, companion: CompanionRow) {
  return {
    id: row.id,
    familyMemberId: row.familyMemberId,
    name: row.name,
    honorific: row.honorific,
    phoneE164: row.phoneE164,
    healthFlags: row.healthFlags,
    paused: row.paused,
    createdAt: row.createdAt,
    companion: { id: companion.id, key: companion.key, displayName: companion.displayName },
  };
}

async function findCompanionByKey(key: (typeof COMPANION_KEYS)[number]): Promise<CompanionRow> {
  const [row] = await db.select().from(companions).where(eq(companions.key, key));
  if (!row) {
    // Should only happen if the seed script (B1.2) hasn't run — a config
    // problem, not a client error, so this is a 500 not a 400/404.
    throw new HttpError(500, "INTERNAL_ERROR", `Companion "${key}" not seeded — run npm run seed`);
  }
  return row;
}

async function findCompanionById(id: string): Promise<CompanionRow> {
  const [row] = await db.select().from(companions).where(eq(companions.id, id));
  if (!row) {
    throw new HttpError(500, "INTERNAL_ERROR", "Companion record missing for elder");
  }
  return row;
}

async function getOwnedElder(familyMemberId: string, elderId: string): Promise<ElderRow> {
  // Malformed ids and ids that belong to another family both read as
  // "not found" — never leak that a resource exists but isn't yours.
  if (!uuidSchema.safeParse(elderId).success) {
    throw new HttpError(404, "NOT_FOUND", "Elder not found");
  }
  const [row] = await db.select().from(elders).where(eq(elders.id, elderId));
  if (!row || row.familyMemberId !== familyMemberId) {
    throw new HttpError(404, "NOT_FOUND", "Elder not found");
  }
  return row;
}

export async function elderRoutes(app: FastifyInstance) {
  app.post("/elders", { preHandler: requireFamily }, async (request, reply) => {
    const body = parseBody(createElderSchema, request.body);
    const companion = await findCompanionByKey(body.companion_key);

    const [inserted] = await db
      .insert(elders)
      .values({
        familyMemberId: request.familyMemberId!,
        name: body.name,
        honorific: body.honorific,
        companionId: companion.id,
        healthFlags: body.health_flags,
        phoneE164: body.phone_e164,
      })
      .returning();

    reply.code(201);
    return serializeElder(inserted, companion);
  });

  app.patch("/elders/:id", { preHandler: requireFamily }, async (request) => {
    const { id } = request.params as { id: string };
    const existing = await getOwnedElder(request.familyMemberId!, id);
    const body = parseBody(patchElderSchema, request.body);

    const companionId = body.companion_key
      ? (await findCompanionByKey(body.companion_key)).id
      : existing.companionId;

    const [updated] = await db
      .update(elders)
      .set({
        honorific: body.honorific ?? existing.honorific,
        healthFlags: body.health_flags ?? existing.healthFlags,
        paused: body.paused ?? existing.paused,
        companionId,
      })
      .where(eq(elders.id, id))
      .returning();

    const companion = await findCompanionById(updated.companionId);
    return serializeElder(updated, companion);
  });

  app.get("/elders", { preHandler: requireFamily }, async (request) => {
    const rows = await db
      .select({ elder: elders, companion: companions })
      .from(elders)
      .innerJoin(companions, eq(elders.companionId, companions.id))
      .where(eq(elders.familyMemberId, request.familyMemberId!));

    return Promise.all(
      rows.map(async ({ elder, companion }) => {
        const [lastMsg] = await db
          .select({ createdAt: conversations.createdAt })
          .from(conversations)
          .where(eq(conversations.elderId, elder.id))
          .orderBy(desc(conversations.createdAt))
          .limit(1);
        const [alertRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(alerts)
          .where(and(eq(alerts.elderId, elder.id), isNull(alerts.resolvedAt)));
        return {
          ...serializeElder(elder, companion),
          lastMessageAt: lastMsg?.createdAt ?? null,
          openAlertCount: alertRow?.count ?? 0,
        };
      }),
    );
  });

  app.get("/elders/:id", { preHandler: requireFamily }, async (request) => {
    const { id } = request.params as { id: string };
    const elder = await getOwnedElder(request.familyMemberId!, id);
    const companion = await findCompanionById(elder.companionId);
    return serializeElder(elder, companion);
  });
}
