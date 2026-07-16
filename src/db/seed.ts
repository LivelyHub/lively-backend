import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "./index.js";
import {
  familyMembers,
  companions,
  elders,
  conversations,
  chairTestResults,
  exerciseLogs,
  medications,
  medicationLogs,
} from "./schema.js";

// Demo-only credentials for the hackathon judge/demo login. Not a real
// secret — this repo is public and these are seeded into a throwaway
// dev/demo database, never production user data.
const DEMO_EMAIL = "demo@lively.app";
const DEMO_PASSWORD = "Demo1234!";
const DEMO_PHONE = "+628123456789";

function daysAgo(n: number, hour = 8): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function upsertCompanion(key: "mbak_asih" | "mas_budi", displayName: string) {
  await db.insert(companions).values({ key, displayName }).onConflictDoNothing({ target: companions.key });
  const [row] = await db.select().from(companions).where(eq(companions.key, key));
  return row;
}

async function upsertFamilyMember() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await db
    .insert(familyMembers)
    .values({ email: DEMO_EMAIL, name: "Budi (demo)", passwordHash })
    .onConflictDoNothing({ target: familyMembers.email });
  const [row] = await db.select().from(familyMembers).where(eq(familyMembers.email, DEMO_EMAIL));
  return row;
}

async function main() {
  const mbakAsih = await upsertCompanion("mbak_asih", "Mbak Asih");
  await upsertCompanion("mas_budi", "Mas Budi");
  const familyMember = await upsertFamilyMember();

  const [existingElder] = await db.select().from(elders).where(eq(elders.phoneE164, DEMO_PHONE));
  if (existingElder) {
    console.log("Demo elder already seeded (phone", DEMO_PHONE, ") — skipping. Re-run with a fresh DB to reseed.");
    return;
  }

  const [elder] = await db
    .insert(elders)
    .values({
      familyMemberId: familyMember.id,
      name: "Siti",
      honorific: "Eyang Uti",
      companionId: mbakAsih.id,
      healthFlags: ["knee_pain"],
      phoneE164: DEMO_PHONE,
    })
    .returning();

  // Chair-test arc: 8 -> 9 -> 11 -> 12, the Progress chart's story.
  const chairTestReps = [8, 9, 11, 12];
  await db.insert(chairTestResults).values(
    chairTestReps.map((reps, i) => ({
      elderId: elder.id,
      reps,
      recordedAt: daysAgo((chairTestReps.length - i) * 5),
      source: "chat" as const,
    })),
  );

  // ~10 mixed in/out conversation messages, warm daily-checkin tone.
  const convoScript: { direction: "in" | "out"; body: string; daysAgo: number; hour: number }[] = [
    { direction: "out", body: "Selamat pagi, Eyang Uti! Sudah sarapan? 😊", daysAgo: 6, hour: 7 },
    { direction: "in", body: "Sudah, tadi makan bubur", daysAgo: 6, hour: 7 },
    { direction: "out", body: "Bagus! Nanti jangan lupa senam ya, Eyang", daysAgo: 6, hour: 7 },
    { direction: "in", body: "Iya nanti sore", daysAgo: 6, hour: 8 },
    { direction: "out", body: "Selamat pagi, Eyang Uti! Gimana tidurnya semalam?", daysAgo: 4, hour: 7 },
    { direction: "in", body: "Nyenyak, badan enak pagi ini", daysAgo: 4, hour: 7 },
    { direction: "out", body: "Senang dengarnya! Sudah siap senam kursi hari ini?", daysAgo: 3, hour: 7 },
    { direction: "in", body: "Sudah, tadi dapat 11 kali", daysAgo: 3, hour: 9 },
    { direction: "out", body: "Wah hebat, Eyang Uti! Naik terus ya 🌟", daysAgo: 3, hour: 9 },
    { direction: "in", body: "Lutut masih agak pegal tapi enak kok", daysAgo: 1, hour: 9 },
  ];
  await db.insert(conversations).values(
    convoScript.map((m) => ({
      elderId: elder.id,
      direction: m.direction,
      body: m.body,
      createdAt: daysAgo(m.daysAgo, m.hour),
    })),
  );

  // Exercise streak of 4 consecutive days (>= the "3+" bar).
  await db.insert(exerciseLogs).values(
    [3, 2, 1, 0].map((d) => ({
      elderId: elder.id,
      completedAt: daysAgo(d, 17),
      method: "reply" as const,
    })),
  );

  const [amlodipine] = await db
    .insert(medications)
    .values({
      elderId: elder.id,
      name: "Amlodipine",
      dosage: "5mg",
      scheduleTimes: ["07:00"],
      active: true,
    })
    .returning();

  // A few days of confirmed doses feeding the adherence block.
  await db.insert(medicationLogs).values(
    [3, 2, 1].map((d) => ({
      medicationId: amlodipine.id,
      elderId: elder.id,
      takenAt: daysAgo(d, 7),
      method: "reply" as const,
    })),
  );

  console.log("Seed complete: demo login", DEMO_EMAIL, "/", DEMO_PASSWORD, "— elder Eyang Uti", elder.id);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
