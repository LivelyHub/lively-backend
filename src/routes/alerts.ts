import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { elders, alerts } from "../db/schema.js";
import { requireBot, requireFamily } from "../lib/auth-guards.js";
import { HttpError, parseBody, parseQuery } from "../lib/http-errors.js";
import { getOwnedElder } from "../lib/owned-elder.js";
import { sendAlertPush } from "../lib/push.js";
import { ALERT_TYPES, raiseAlert } from "../lib/alerts.js";

const uuidSchema = z.string().uuid();

const createAlertSchema = z.object({
  elder_id: z.string().uuid(),
  type: z.enum(ALERT_TYPES),
  payload: z.unknown().optional(),
});

const alertsQuerySchema = z.object({
  // Optional (found during local-connection reconciliation: mobile calls
  // GET /alerts with no elder_id at all for a cross-elder alert banner) —
  // when omitted, alerts span every elder owned by the authenticated
  // family member instead of one.
  elder_id: z.string().uuid().optional(),
  unresolved_only: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

// One PATCH /alerts/:id body shape covers two distinct family actions:
// resolving (CORE §2) and manual-urgent escalation (CORE §6 — only ever to
// 'emergency', never a free-form type edit). Consolidated into one route
// (dropping the separate /resolve sub-route) because mobile's client only
// ever calls PATCH /alerts/:id.
const patchAlertSchema = z.union([z.object({ resolved: z.literal(true) }), z.object({ type: z.literal("emergency") })]);

type AlertRow = typeof alerts.$inferSelect;

function serializeAlert(row: AlertRow) {
  return {
    id: row.id,
    elder_id: row.elderId,
    type: row.type,
    payload: row.payload,
    created_at: row.createdAt,
    resolved_at: row.resolvedAt,
  };
}

async function getOwnedAlert(familyMemberId: string, alertId: string): Promise<AlertRow> {
  if (!uuidSchema.safeParse(alertId).success) {
    throw new HttpError(404, "NOT_FOUND", "Alert not found");
  }
  const [row] = await db
    .select({ alert: alerts, elder: elders })
    .from(alerts)
    .innerJoin(elders, eq(alerts.elderId, elders.id))
    .where(eq(alerts.id, alertId));
  if (!row || row.elder.familyMemberId !== familyMemberId) {
    throw new HttpError(404, "NOT_FOUND", "Alert not found");
  }
  return row.alert;
}

export async function alertRoutes(app: FastifyInstance) {
  app.post("/alerts", { preHandler: requireBot }, async (request, reply) => {
    const body = parseBody(createAlertSchema, request.body);
    const [elder] = await db.select().from(elders).where(eq(elders.id, body.elder_id));
    if (!elder) {
      throw new HttpError(404, "NOT_FOUND", "Elder not found");
    }

    const { row, wasNew } = await raiseAlert(elder.id, body.type, body.payload, (err: unknown) => {
      app.log.error(err, "push send failed");
    });

    reply.code(wasNew ? 201 : 200);
    return serializeAlert(row);
  });

  app.get("/alerts", { preHandler: requireFamily }, async (request) => {
    const query = parseQuery(alertsQuerySchema, request.query);

    if (query.elder_id) {
      await getOwnedElder(request.familyMemberId!, query.elder_id);
      const whereClause = query.unresolved_only
        ? and(eq(alerts.elderId, query.elder_id), isNull(alerts.resolvedAt))
        : eq(alerts.elderId, query.elder_id);
      const rows = await db.select().from(alerts).where(whereClause).orderBy(desc(alerts.createdAt));
      return rows.map(serializeAlert);
    }

    // No elder_id: every alert across every elder this family member owns.
    const rows = await db
      .select({ alert: alerts })
      .from(alerts)
      .innerJoin(elders, eq(alerts.elderId, elders.id))
      .where(
        query.unresolved_only
          ? and(eq(elders.familyMemberId, request.familyMemberId!), isNull(alerts.resolvedAt))
          : eq(elders.familyMemberId, request.familyMemberId!),
      )
      .orderBy(desc(alerts.createdAt));
    return rows.map(({ alert }) => serializeAlert(alert));
  });

  app.patch("/alerts/:id", { preHandler: requireFamily }, async (request) => {
    const { id } = request.params as { id: string };
    const existing = await getOwnedAlert(request.familyMemberId!, id);
    const body = parseBody(patchAlertSchema, request.body);

    if ("resolved" in body) {
      if (existing.resolvedAt) {
        return serializeAlert(existing);
      }
      const [updated] = await db.update(alerts).set({ resolvedAt: new Date() }).where(eq(alerts.id, id)).returning();
      return serializeAlert(updated!);
    }

    const [updated] = await db.update(alerts).set({ type: "emergency" }).where(eq(alerts.id, id)).returning();

    const [elder] = await db.select().from(elders).where(eq(elders.id, existing.elderId));
    if (elder) {
      sendAlertPush(elder, "emergency", updated!.payload).catch((err: unknown) => {
        app.log.error(err, "push send failed");
      });
    }

    return serializeAlert(updated!);
  });
}
