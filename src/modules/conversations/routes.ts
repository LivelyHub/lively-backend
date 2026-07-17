import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { elders, conversations } from "../../db/schema.js";
import { requireBot, requireFamily } from "../../shared/auth-guards.js";
import { HttpError, parseBody, parseQuery } from "../../shared/http-errors.js";
import { findCompanionById } from "../elders/service.js";
import { getOwnedElder } from "../../shared/owned-elder.js";
import { recordInboundMessage } from "./service.js";
import { sendWhatsAppText, whatsappSendConfigured } from "../../shared/whatsapp.js";

const PHONE_E164_REGEX = /^\+[1-9]\d{6,14}$/;

const inboundSchema = z.object({
  elder_phone_e164: z.string().regex(PHONE_E164_REGEX, "Must be E.164 format, e.g. +628123456789"),
  body: z.string().trim().min(1).max(4000),
});

const outboundSchema = z.object({
  elder_id: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});

// camelCase, unlike the rest of the bot contract: matches what
// lively-bot's reminder scheduler (src/reminders.ts) actually sends.
const sendSchema = z.object({
  elderId: z.string().uuid(),
  text: z.string().trim().min(1).max(4000),
  kind: z.string().trim().min(1).max(50).optional(),
});

const conversationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    before: z.string().uuid().optional(),
    after: z.string().uuid().optional(),
  })
  .refine((q) => !(q.before && q.after), { message: "Provide only one of before or after" });

type ConversationRow = typeof conversations.$inferSelect;

// CORE.md §2/§3 documents this pair's field names literally in
// snake_case (elder_id, recent_messages, created_at) as the exact
// cross-repo contract lively-bot codes against — matched verbatim
// here, unlike the rest of this API which uses camelCase.
function serializeMessage(row: ConversationRow) {
  return { id: row.id, direction: row.direction, body: row.body, created_at: row.createdAt };
}

export async function conversationRoutes(app: FastifyInstance) {
  app.post("/bot/inbound", { preHandler: requireBot }, async (request) => {
    const body = parseBody(inboundSchema, request.body);
    const elder = await recordInboundMessage(body.elder_phone_e164, body.body);
    if (!elder) {
      throw new HttpError(404, "NOT_FOUND", "No elder with this phone number");
    }

    const companion = await findCompanionById(elder.companionId);
    const recent = await db
      .select()
      .from(conversations)
      .where(eq(conversations.elderId, elder.id))
      .orderBy(desc(conversations.createdAt))
      .limit(10);

    return {
      elder_id: elder.id,
      companion: {
        key: companion.key,
        honorific: elder.honorific,
        healthFlags: elder.healthFlags,
        personalize: elder.personalize ?? null,
      },
      paused: elder.paused,
      recent_messages: recent.reverse().map(serializeMessage),
    };
  });

  app.post("/bot/outbound", { preHandler: requireBot }, async (request, reply) => {
    const body = parseBody(outboundSchema, request.body);
    const [elder] = await db.select().from(elders).where(eq(elders.id, body.elder_id));
    if (!elder) {
      throw new HttpError(404, "NOT_FOUND", "Elder not found");
    }

    const [inserted] = await db
      .insert(conversations)
      .values({ elderId: elder.id, direction: "out", body: body.body })
      .returning();

    reply.code(201);
    return serializeMessage(inserted);
  });

  // Proactive bot-initiated delivery (medication reminders etc.): unlike
  // /bot/outbound, which only logs a message the bot already sent itself,
  // this one owns the WhatsApp delivery — lively-bot has no Cloud API
  // credentials, so it generates the text and the backend sends it.
  app.post("/bot/send", { preHandler: requireBot }, async (request, reply) => {
    const body = parseBody(sendSchema, request.body);
    const [elder] = await db.select().from(elders).where(eq(elders.id, body.elderId));
    if (!elder) {
      throw new HttpError(404, "NOT_FOUND", "Elder not found");
    }
    if (elder.paused) {
      throw new HttpError(403, "ELDER_PAUSED", "Elder is paused — proactive sends are disabled");
    }
    if (!whatsappSendConfigured()) {
      throw new HttpError(503, "SEND_UNAVAILABLE", "WhatsApp send is not configured on this deployment");
    }

    await sendWhatsAppText(elder.phoneE164, body.text);
    request.log.info({ elderId: elder.id, kind: body.kind ?? "unspecified" }, "bot-initiated send delivered");

    // Logged only after a successful send, same rule as companion-reply:
    // the Chat Monitor must never show a message the elder didn't get.
    const [inserted] = await db
      .insert(conversations)
      .values({ elderId: elder.id, direction: "out", body: body.text })
      .returning();

    reply.code(201);
    return serializeMessage(inserted);
  });

  app.get("/elders/:id/conversation", { preHandler: requireFamily }, async (request) => {
    const { id } = request.params as { id: string };
    await getOwnedElder(request.familyMemberId!, id);
    const query = parseQuery(conversationQuerySchema, request.query);

    // Cursor comparisons are done entirely in SQL via a subquery, never by
    // fetching a cursor's created_at into JS and reinserting it as a Date:
    // JS Date only has millisecond precision but timestamptz has microsecond
    // precision, so a round-tripped Date silently truncates and a message
    // can end up ">" its own untruncated self, leaking into its own results.
    if (query.after) {
      const [afterRow] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, query.after));
      if (!afterRow) {
        throw new HttpError(400, "VALIDATION", "Unknown cursor", { after: "No message with this id" });
      }
      const rows = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.elderId, id),
            sql`${conversations.createdAt} > (SELECT created_at FROM conversations WHERE id = ${query.after})`,
          ),
        )
        .orderBy(asc(conversations.createdAt))
        .limit(query.limit);
      return {
        messages: rows.map(serializeMessage),
        next_cursor: rows.length > 0 ? rows[rows.length - 1]!.id : null,
      };
    }

    if (query.before) {
      const [beforeRow] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, query.before));
      if (!beforeRow) {
        throw new HttpError(400, "VALIDATION", "Unknown cursor", { before: "No message with this id" });
      }
    }

    const whereClause = query.before
      ? and(
          eq(conversations.elderId, id),
          sql`${conversations.createdAt} < (SELECT created_at FROM conversations WHERE id = ${query.before})`,
        )
      : eq(conversations.elderId, id);

    const rows = await db
      .select()
      .from(conversations)
      .where(whereClause)
      .orderBy(desc(conversations.createdAt))
      .limit(query.limit);

    return {
      messages: rows.map(serializeMessage),
      next_cursor: rows.length === query.limit ? rows[rows.length - 1]!.id : null,
    };
  });
}
