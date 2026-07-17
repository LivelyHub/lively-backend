import type { familyMembers } from "../db/schema.js";

type FamilyMemberRow = typeof familyMembers.$inferSelect;

// snake_case to match lively-mobile/lib/api/types.ts's FamilyMember contract
// (mobile's own assumption — verified correct during local-connection
// reconciliation; passwordHash is deliberately never included).
export function serializeFamilyMember(row: FamilyMemberRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    push_token: row.pushToken,
    created_at: row.createdAt,
  };
}
