# lively-backend — Plan

**Window:** 2026-07-16 → 2026-07-18 (Garuda Hacks 7.0, offline). ~3 days. Solo/small-team repo owner. Assumes schema in [CORE.md](CORE.md) as the target shape; DB and API ship together in this repo.

## Setup (Day 0 / early Day 1)
- Env (all via env vars, never committed): `DATABASE_URL` (Neon connection string), `BOT_SERVICE_KEY`, `JWT_SECRET`, `PORT`. Ship `.env.example` only.
- Accounts: Neon project created, connection string on hand.
- Tooling: Node.js, Fastify, a migration tool (e.g. `node-pg-migrate` or Prisma — 🟡 pick on Day 1, not decided yet).
- Repo: public; README skeleton + license + `.gitignore` (this pass).

## Definition of Done (the bar)
1. Neon Postgres schema live, matching [CORE.md](CORE.md) §1.
2. All endpoints in [CORE.md](CORE.md) §2 implemented and reachable, auth-gated (JWT for mobile, `BOT_SERVICE_KEY` for bot).
3. `lively-mobile` can create an elder + read a conversation against this API.
4. `lively-bot` can log inbound/outbound messages and raise an alert against this API.
> Items 3–4 are what let the other repos demo — this repo qualifies the whole team for judging, not just itself.

## Day-by-day
**Day 1 — 2026-07-16 — schema + skeleton (highest-risk first)**
- Stand up Fastify project, connect to Neon, confirm `DATABASE_URL` works from a laptop off the venue Wi-Fi (🔴 risk: venue network blocking outbound DB connections — test immediately).
- Create schema (elders, family_members, companions, conversations, chair_test_results, exercise_logs, alerts, titipan_messages).
- Implement `POST /elders`, `PATCH /elders/:id`, `GET /elders/:id/conversation` (mobile needs these first).

**Day 2 — 2026-07-17 — bot-facing endpoints + auth**
- Implement `POST /bot/inbound`, `POST /bot/outbound`, `POST /assessments/chair-test`, `POST /exercise-logs`, `POST /medications`, `POST /medication-logs`, `POST /alerts` (including `medication_missed`, `no_response`, `emergency` types).
- Wire JWT auth for mobile, static-key auth for bot.
- Extend `GET /elders/:id/progress` with `overall_progress_pct`, `engagement_streak_days`, `exercise_history`, `medication_adherence_trend` (CORE.md §7) — cheap, same query as the existing aggregate, do it same day as B5.3.
- Integration pass with `lively-mobile` and `lively-bot` against a shared dev DB.

**Day 3 — 2026-07-18 — buffer, polish, submit**
- Fix integration breakage found on Day 2.
- Seed demo elder "Eyang Uti" with mock chair-test history (8 → 12) for the Progress screen chart.
- If time allows: `GET /elders/:id/report?period=week|month` (the performance report — genuinely new work, not a reuse of B5.3). Build only after the P0 spine is green.
- Freeze API — no schema changes after mid-day. Submit with margin before deadline.

## Honest feasibility verdict
Achievable in this window **if** the schema is frozen by end of Day 1 — the biggest schedule risk is mobile/bot/backend renegotiating the data shape mid-hackathon, which cascades into all three repos. Mitigation: treat [CORE.md](CORE.md) as locked once Day 1 ends; any change requires updating all four copies before anyone continues.

Cut-order if time compresses: drop `titipan_messages` and `alerts` (missed-day push) last-in-first-cut, then `GET /elders/:id/report` (performance report) — it's new-feedback scope layered on top of an already-tight window, and the progress bar/streak/graphs already ship the bulk of the gamification value cheaply via B5.3. The irreducible core stays elder creation, conversation logging, and chair-test recording.
