import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { elders } from "../db/schema.js";
import { HttpError } from "./http-errors.js";

const uuidSchema = z.string().uuid();

type ElderRow = typeof elders.$inferSelect;

export async function getOwnedElder(familyMemberId: string, elderId: string): Promise<ElderRow> {
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
