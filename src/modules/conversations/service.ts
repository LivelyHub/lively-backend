import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { elders, conversations, botContacts } from "../../db/schema.js";

// Shared by POST /bot/inbound and POST /webhook: upsert the sender into
// bot_contacts (unknown numbers included), and log the message iff the
// number belongs to a registered elder. Returns the elder row or null.
export async function recordInboundMessage(phoneE164: string, body: string) {
  const [elder] = await db.select().from(elders).where(eq(elders.phoneE164, phoneE164));

  await db
    .insert(botContacts)
    .values({ elderId: elder?.id ?? null, phoneE164 })
    .onConflictDoUpdate({
      target: botContacts.phoneE164,
      set: {
        elderId: elder?.id ?? null,
        lastSeenAt: sql`now()`,
        messageCount: sql`${botContacts.messageCount} + 1`,
      },
    });

  if (!elder) return null;

  await db.insert(conversations).values({ elderId: elder.id, direction: "in", body });
  return elder;
}
