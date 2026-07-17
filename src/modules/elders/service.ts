import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { companions } from "../../db/schema.js";
import { HttpError } from "../../shared/http-errors.js";

export const COMPANION_KEYS = ["mbak_asih", "mas_budi"] as const;

type CompanionRow = typeof companions.$inferSelect;

export async function findCompanionByKey(key: (typeof COMPANION_KEYS)[number]): Promise<CompanionRow> {
  const [row] = await db.select().from(companions).where(eq(companions.key, key));
  if (!row) {
    // Should only happen if the seed script (B1.2) hasn't run — a config
    // problem, not a client error, so this is a 500 not a 400/404.
    throw new HttpError(500, "INTERNAL_ERROR", `Companion "${key}" not seeded — run npm run seed`);
  }
  return row;
}

export async function findCompanionById(id: string): Promise<CompanionRow> {
  const [row] = await db.select().from(companions).where(eq(companions.id, id));
  if (!row) {
    throw new HttpError(500, "INTERNAL_ERROR", "Companion record missing for elder");
  }
  return row;
}
