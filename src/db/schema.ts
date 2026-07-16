import {
  pgTable,
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

export const familyMembers = pgTable("family_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  pushToken: text("push_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companions = pgTable("companions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key", { enum: ["mbak_asih", "mas_budi"] }).notNull(),
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
  phoneE164: text("phone_e164").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    elderId: uuid("elder_id")
      .notNull()
      .references(() => elders.id),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
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
  source: text("source", { enum: ["chat"] }).notNull(),
});

export const exerciseLogs = pgTable("exercise_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  elderId: uuid("elder_id")
    .notNull()
    .references(() => elders.id),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  method: text("method", { enum: ["reply", "emoji", "photo"] }).notNull(),
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
    method: text("method", { enum: ["reply", "emoji", "photo"] }).notNull(),
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
    type: text("type", {
      enum: [
        "missed_days",
        "pain_mention",
        "dizziness_mention",
        "medication_missed",
        "no_response",
        "emergency",
      ],
    }).notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [index("alerts_elder_created_idx").on(table.elderId, table.createdAt)],
);

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
});
