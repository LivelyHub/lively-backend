import type { FastifyBaseLogger } from "fastify";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { medications, type elders, type companions } from "../db/schema.js";

type ElderRow = typeof elders.$inferSelect;
type CompanionRow = typeof companions.$inferSelect;

// lively-bot dropped its two fixed personas for a per-elder freeform `Soul`
// (POST /soul, one-time registration — src/soul/prompt.ts on that side).
// Backend owns the elder record, so backend pushes the soul whenever it
// changes rather than lively-bot pulling it on every /reply call.
function botUrl(path: string): string | undefined {
  const baseUrl = process.env.BOT_REPLY_URL;
  if (!baseUrl) return undefined;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function botPost(path: string, body: unknown, log: FastifyBaseLogger, what: string): Promise<void> {
  const url = botUrl(path);
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.BOT_SERVICE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log.error({ status: res.status, what }, "lively-bot sync call failed");
    }
  } catch (err) {
    log.error({ err, what }, "lively-bot sync call threw");
  }
}

// Fire-and-forget, same pattern as sendElderIntroMessage: caller (POST/PATCH
// /elders) must not block its response on lively-bot being reachable.
export function syncElderSoul(elder: ElderRow, companion: CompanionRow, log: FastifyBaseLogger): void {
  const soul = {
    companionName: companion.displayName,
    elderName: elder.name,
    honorific: elder.honorific,
    healthFlags: elder.healthFlags,
    // elders has no timezone column (CORE.md §1) — single-market default,
    // same as shared/companion-reply.ts.
    timezone: "Asia/Jakarta",
  };
  void botPost("/soul", { elderId: elder.id, soul }, log, "soul");
}

// Replaces lively-bot's whole tracked schedule for this elder (its own
// semantics, see lively-bot/src/server.ts) — call with the elder's full
// current active list, not a diff.
export function syncElderMedications(elderId: string, log: FastifyBaseLogger): void {
  void (async () => {
    const activeMeds = await db
      .select()
      .from(medications)
      .where(and(eq(medications.elderId, elderId), eq(medications.active, true)));

    const payload = activeMeds.map((m) => ({
      name: m.name,
      dose: m.dosage,
      schedule: m.scheduleTimes.map((t) => t.slice(0, 5)).join(", "),
    }));

    await botPost("/medications", { elderId, medications: payload }, log, "medications");
  })();
}
