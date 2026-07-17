import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  time,
  index,
} from "drizzle-orm/pg-core";

// Schema mirrors CORE.md §1 — keep this file and CORE.md in sync.
// Enum-like fields use pg native enums, not text+TS-narrowing, so bad
// values are rejected by Postgres itself (BACKLOG.md B1.1's own test).

export interface ElderPersonalize {
  family?: { name: string; relation: string }[];
  hobbies?: string[];
  favorite_topics?: string[];
  avoid_topics?: string[];
  speech_style?: string;
}

export const companionKeyEnum = pgEnum("companion_key", ["mbak_asih", "mas_budi"]);
export const directionEnum = pgEnum("direction", ["in", "out"]);
export const chairTestSourceEnum = pgEnum("chair_test_source", ["chat"]);
export const logMethodEnum = pgEnum("log_method", ["reply", "emoji", "photo"]);
export const alertTypeEnum = pgEnum("alert_type", [
  "missed_days",
  "pain_mention",
  "dizziness_mention",
  "medication_missed",
  "no_response",
  "emergency",
]);

export const familyMembers = pgTable("family_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  // Amendment #2 (BACKLOG.md) applied in B1 — B2 needs this to exist before the freeze.
  passwordHash: text("password_hash").notNull(),
  pushToken: text("push_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companions = pgTable("companions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // unique: exactly one row per persona — lets elders.companion_id and
  // the seed script look a persona up by key instead of guessing an id.
  key: companionKeyEnum("key").notNull().unique(),
  displayName: text("display_name").notNull(),
  systemPromptRef: text("system_prompt_ref"),
});

export const elders = pgTable("elders", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyMemberId: uuid("family_member_id")
    .notNull()
    .references(() => familyMembers.id),
  name: text("name").notNull(),
  honorific: text("honorific").notNull(),
  companionId: uuid("companion_id")
    .notNull()
    .references(() => companions.id),
  healthFlags: text("health_flags").array().notNull().default([]),
  // Free-form persona detail (hobbies, family names, speech style, etc.)
  // collected by mobile's profile-completion flow, not the initial elder
  // form — forwarded to lively-bot via POST /bot/inbound's companion object
  // so it can build a richer per-elder system prompt ("SOUL.md").
  personalize: jsonb("personalize").$type<ElderPersonalize>(),
  // unique: POST /bot/inbound (CORE.md §2) resolves the elder by phone —
  // without this, two elders sharing a number would make that lookup ambiguous.
  phoneE164: text("phone_e164").notNull().unique(),
  // Amendment #4 (BACKLOG.md) applied in B1 — CORE.md §2 already lists
  // PATCH /elders/:id as "pause" but the column didn't exist until now.
  paused: boolean("paused").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Every phone number that has ever messaged the bot, registered or not.
// elder_id stays null for unknown senders — /bot/inbound still 404s for
// them, but the contact row means the number is never silently dropped.
export const botContacts = pgTable("bot_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  phoneE164: text("phone_e164").notNull().unique(),
  elderId: uuid("elder_id").references(() => elders.id),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  messageCount: integer("message_count").notNull().default(1),
});

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    elderId: uuid("elder_id")
      .notNull()
      .references(() => elders.id),
    direction: directionEnum("direction").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("conversations_elder_created_idx").on(table.elderId, table.createdAt)],
);

export const chairTestResults = pgTable("chair_test_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  elderId: uuid("elder_id")
    .notNull()
    .references(() => elders.id),
  reps: integer("reps").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  source: chairTestSourceEnum("source").notNull(),
});

export const exerciseLogs = pgTable("exercise_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  elderId: uuid("elder_id")
    .notNull()
    .references(() => elders.id),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  method: logMethodEnum("method").notNull(),
  // Set when method = 'photo' (points at /uploads/<file>, see shared/uploads.ts).
  photoUrl: text("photo_url"),
});

export const medications = pgTable("medications", {
  id: uuid("id").primaryKey().defaultRandom(),
  elderId: uuid("elder_id")
    .notNull()
    .references(() => elders.id),
  name: text("name").notNull(),
  dosage: text("dosage").notNull(),
  scheduleTimes: time("schedule_times").array().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const medicationLogs = pgTable(
  "medication_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    medicationId: uuid("medication_id")
      .notNull()
      .references(() => medications.id),
    elderId: uuid("elder_id")
      .notNull()
      .references(() => elders.id),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
    method: logMethodEnum("method").notNull(),
    // Set when method = 'photo' (points at /uploads/<file>, see shared/uploads.ts).
    photoUrl: text("photo_url"),
  },
  (table) => [index("medication_logs_med_taken_idx").on(table.medicationId, table.takenAt)],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    elderId: uuid("elder_id")
      .notNull()
      .references(() => elders.id),
    type: alertTypeEnum("type").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [index("alerts_elder_created_idx").on(table.elderId, table.createdAt)],
);

// One row per logged-out token (keyed by its jti claim, added at sign time).
// requireFamily checks this on every request — a small extra query, but
// this is the only way to make a 7-day JWT actually revocable without
// standing up a session store. Rows can be pruned by expiresAt once the
// underlying token itself would no longer verify anyway.
export const revokedTokens = pgTable("revoked_tokens", {
  jti: uuid("jti").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
});

export const titipanMessages = pgTable("titipan_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  elderId: uuid("elder_id")
    .notNull()
    .references(() => elders.id),
  familyMemberId: uuid("family_member_id")
    .notNull()
    .references(() => familyMembers.id),
  body: text("body").notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
