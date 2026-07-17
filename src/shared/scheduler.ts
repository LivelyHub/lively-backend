import type { FastifyBaseLogger } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { elders, medications, conversations } from "../db/schema.js";
import { sendWhatsAppText, whatsappSendConfigured } from "./whatsapp.js";

// CORE.md §5: "Lively owns the scheduler for check-ins, medication
// reminders, and no-response checks" — backend, not lively-bot, which is
// a stateless per-call AI service with no DB or WhatsApp send capability
// (lively-bot SPEC.md §5). In-process setInterval ticker, not a cron
// package: hackathon scale, one process, no infra to stand up for it.

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000; // WIB, no DST — same fixed
// single-market default already hardcoded in shared/companion-reply.ts;
// schema has no per-elder timezone column (shared/dates.ts).
const MORNING_BRIEFING_TIME = "07:00";
const CHAIR_REMINDER_WEEKDAY = 1; // Monday, Jakarta wall clock

function jakartaNow(): { hhmm: string; dateStr: string; weekday: number } {
  const j = new Date(Date.now() + JAKARTA_OFFSET_MS);
  const hhmm = `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
  return { hhmm, dateStr: j.toISOString().slice(0, 10), weekday: j.getUTCDay() };
}

// ponytail: in-memory de-dup sets, reset on restart — a reminder resent
// after a crash is an acceptable ceiling at hackathon scale. Upgrade to a
// sent_reminders table if double-sends become a real complaint.
const sentMedication = new Set<string>();
const sentBriefing = new Set<string>();

async function sendAndLog(elderId: string, phoneE164: string, body: string, log: FastifyBaseLogger): Promise<void> {
  try {
    await sendWhatsAppText(phoneE164, body);
    await db.insert(conversations).values({ elderId, direction: "out", body });
  } catch (err) {
    log.error({ err, elderId }, "scheduled reminder send failed");
  }
}

async function tick(log: FastifyBaseLogger): Promise<void> {
  if (!whatsappSendConfigured()) return;
  const { hhmm, dateStr, weekday } = jakartaNow();

  const activeElders = await db.select().from(elders).where(eq(elders.paused, false));
  const eldersById = new Map(activeElders.map((e) => [e.id, e]));

  const activeMeds = await db.select().from(medications).where(eq(medications.active, true));
  for (const med of activeMeds) {
    const elder = eldersById.get(med.elderId);
    if (!elder) continue;
    if (!med.scheduleTimes.some((t) => t.slice(0, 5) === hhmm)) continue;
    const key = `${med.id}:${dateStr}:${hhmm}`;
    if (sentMedication.has(key)) continue;
    sentMedication.add(key);
    await sendAndLog(elder.id, elder.phoneE164, `Waktunya minum obat ${med.name} (${med.dosage}), ${elder.honorific}.`, log);
  }

  if (hhmm === MORNING_BRIEFING_TIME) {
    for (const elder of activeElders) {
      const key = `${elder.id}:${dateStr}`;
      if (sentBriefing.has(key)) continue;
      sentBriefing.add(key);
      const lines = [`Selamat pagi, ${elder.honorific}! Jangan lupa senam kursi hari ini ya.`];
      if (weekday === CHAIR_REMINDER_WEEKDAY) {
        lines.push(
          "Juga waktunya tes kursi 30 detik minggu ini — hitung berapa kali berdiri-duduk dalam 30 detik, lalu kabari saya ya.",
        );
      }
      await sendAndLog(elder.id, elder.phoneE164, lines.join(" "), log);
    }
  }
}

let interval: NodeJS.Timeout | undefined;

export function startScheduler(log: FastifyBaseLogger): void {
  if (interval) return;
  interval = setInterval(() => {
    tick(log).catch((err) => log.error({ err }, "scheduler tick failed"));
  }, 60_000);
  interval.unref();
}

export function stopScheduler(): void {
  clearInterval(interval);
  interval = undefined;
}
