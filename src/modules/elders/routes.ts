import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { elders, companions, conversations, alerts } from "../../db/schema.js";
import { requireFamily } from "../../shared/auth-guards.js";
import { HttpError, isUniqueViolation, parseBody } from "../../shared/http-errors.js";
import { COMPANION_KEYS, findCompanionByKey, findCompanionById } from "./service.js";
import { getOwnedElder } from "../../shared/owned-elder.js";
import { sendElderIntroMessage } from "./intro.js";

const PHONE_E164_REGEX = /^\+[1-9]\d{6,14}$/;

const healthFlagsSchema = z.array(z.string().trim().min(1).max(60)).max(20);

const shortStringList = z.array(z.string().trim().min(1).max(120)).max(20);

// Loose on purpose: profile fills in gradually, LLM prompt-building on the
// bot side tolerates partial/messy data — no enums, no required fields.
const personalizeSchema = z.object({
  family: z
    .array(z.object({ name: z.string().trim().min(1).max(100), relation: z.string().trim().min(1).max(60) }))
    .max(20)
    .optional(),
  hobbies: shortStringList.optional(),
  favorite_topics: shortStringList.optional(),
  avoid_topics: shortStringList.optional(),
  speech_style: z.string().trim().min(1).max(500).optional(),
});

const createElderSchema = z.object({
  name: z.string().trim().min(1).max(200),
  honorific: z.string().trim().min(1).max(100),
  phone_e164: z.string().regex(PHONE_E164_REGEX, "Must be E.164 format, e.g. +628123456789"),
  companion_key: z.enum(COMPANION_KEYS),
  health_flags: healthFlagsSchema.default([]),
  personalize: personalizeSchema.optional(),
});

const patchElderSchema = z.object({
  honorific: z.string().trim().min(1).max(100).optional(),
  companion_key: z.enum(COMPANION_KEYS).optional(),
  health_flags: healthFlagsSchema.optional(),
  paused: z.boolean().optional(),
  personalize: personalizeSchema.optional(),
});

type ElderRow = typeof elders.$inferSelect;
type CompanionRow = typeof companions.$inferSelect;

// snake_case to match lively-mobile/lib/api/types.ts's Elder contract.
// companion_key (not just companion_id) is included deliberately: mobile
// resolves companion display metadata (name/avatar/tint) from a fixed
// client-side table (lib/companions.ts) keyed by 'mbak_asih'|'mas_budi',
// not from a server round-trip — a bare companion_id UUID gives it nothing
// to key off (found during local-connection reconciliation: mobile's prior
// code guessed the key by checking whether the id string contained "budi",
// which only worked against mock fixture ids, never real UUIDs).
function serializeElder(row: ElderRow, companion: CompanionRow) {
  return {
    id: row.id,
    family_member_id: row.familyMemberId,
    name: row.name,
    honorific: row.honorific,
    companion_id: companion.id,
    companion_key: companion.key,
    health_flags: row.healthFlags,
    personalize: row.personalize ?? null,
    phone_e164: row.phoneE164,
    paused: row.paused,
    created_at: row.createdAt,
  };
}

export async function elderRoutes(app: FastifyInstance) {
  app.post("/elders", { preHandler: requireFamily }, async (request, reply) => {
    const body = parseBody(createElderSchema, request.body);
    const companion = await findCompanionByKey(body.companion_key);

    let inserted;
    try {
      [inserted] = await db
        .insert(elders)
        .values({
          familyMemberId: request.familyMemberId!,
          name: body.name,
          honorific: body.honorific,
          companionId: companion.id,
          healthFlags: body.health_flags,
          personalize: body.personalize,
          phoneE164: body.phone_e164,
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError(409, "CONFLICT", "An elder with this phone number already exists");
      }
      throw err;
    }

    sendElderIntroMessage(inserted, companion, app.log);

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
        personalize: body.personalize ?? existing.personalize,
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
          last_message_at: lastMsg?.createdAt ?? null,
          open_alert_count: alertRow?.count ?? 0,
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
