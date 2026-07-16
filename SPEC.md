# lively-backend — Spec

> The REST API + Postgres data layer that `lively-mobile` and `lively-bot` both depend on. This spec covers only the backend-specific implementation (Fastify service, migrations, auth) — the shared data model and endpoint contract live in [CORE.md](CORE.md).

## 1. Hackathon context
| Field | Value |
|-------|-------|
| Event | Garuda Hacks 7.0 (offline) |
| Submit by | 2026-07-18 — exact time 🔴 TBD |
| QUALIFICATION GATE | Working demo + repo + pitch deck submitted |
| Judging | 🔴 TBD — criteria/weights not yet published |

**Chosen track:** Health — Lively targets the health-literacy and eldercare gap between urban and rural Indonesian families named in the theme brief, using a fall-risk assessment (30s Chair Stand) and daily strength coaching as the clinical backbone.

## 2. Problem & target user
**User:** the Fastify service has no end users of its own — its users are the other two Lively repos (`lively-mobile`, `lively-bot`) that need a shared, consistent source of truth for elder data, conversation history, and assessment results. **Problem:** without a single backend, mobile and bot would each hold their own copy of "what the elder said" and drift out of sync.

## 3. Concept
- `lively-mobile` writes elder setup (companion, honorific, health flags) → backend stores it → `lively-bot` reads it to build the LLM system prompt.
- `lively-bot` logs every inbound/outbound WhatsApp message → backend stores it → `lively-mobile`'s Chat Monitor reads it live.
- `lively-bot` posts chair-test results and exercise completions → backend aggregates them → `lively-mobile`'s Progress screen renders the streak/chart.
- `lively-bot` posts alerts (missed days, pain/dizziness mentions) → backend triggers the family push notification.
- Alternative considered: let `lively-bot` write directly to a shared DB with no API layer. Rejected — a thin API keeps auth, validation, and schema changes in one place instead of forked across two codebases.

## 4. MVP features (YAGNI-tight)
**In scope (the demoable spine):**
- Elder CRUD (create, switch companion/honorific, pause) — `POST/PATCH /elders`
- Conversation log read/write — `GET /elders/:id/conversation`, `POST /bot/inbound`, `POST /bot/outbound`
- Chair-test result recording — `POST /assessments/chair-test`
- Exercise completion logging — `POST /exercise-logs`
- Medication CRUD + dose logging — `POST /medications`, `POST /medication-logs`
- Alert creation (missed-day, pain, dizziness, medication-missed, no-response, emergency) — `POST /alerts`
- Titipan (family message relay) — `POST /elders/:id/titipan`
- Gamification & family reporting (added post-kickoff, per mentor/judge feedback — see CORE.md §7): progress bar, engagement streak, and progress graphs via `GET /elders/:id/progress`; weekly/monthly performance summary via `GET /elders/:id/report`. Reuses existing tables, no schema change. This is what makes the Progress screen feel like a shared win instead of a compliance checklist for the family.

**Explicitly NOT in MVP** → §6.

## 5. Architecture
Fastify (Node.js/TypeScript) service, single deployable, PostgreSQL on Neon.

```
lively-mobile ──JWT──▶ lively-backend ──BOT_SERVICE_KEY──▶ lively-bot
                            │
                            ▼
                      Postgres (Neon)
```

Migrations: 🟡 TBD — pick `node-pg-migrate` or Prisma on Day 1; whichever ships schema changes fastest under time pressure.

## 6. Non-goals
- No admin dashboard — the family app is the only client UI.
- No multi-region DB replication — single Neon instance, hackathon scope.
- No rate limiting / abuse protection — trusted two-client system for the demo, not public-internet-facing at scale.
- No push notification delivery itself — backend raises the alert record; actual push delivery is `lively-mobile`'s concern (Expo push or Firebase, per that repo's SPEC).

## 7. Risks & unknowns
- 🔴 Venue Wi-Fi blocking outbound Postgres connections to Neon — verify on Day 1 morning, before building anything else. Fallback: local Postgres via Docker, migrate connection string at demo time.
- 🟡 Schema churn mid-hackathon as mobile/bot discover missing fields — mitigate by freezing [CORE.md](CORE.md) schema by end of Day 1.
- 🔴 Gamification scope landed after Day 1 kickoff with ~2 days left on the clock. Mitigated by design: no new tables, everything computed from existing rows. `GET /elders/:id/report` (the performance report) is the one genuinely new endpoint — see PLAN.md cut-order if time compresses.
- 🟢 Fastify + Neon is a well-trodden combo — low framework risk.

## 8. Submission checklist (mapped to THIS event's deliverables)
- [ ] Working demo (backend reachable by mobile + bot at demo time)
- [ ] Public repo with README, LICENSE, `.gitignore`, no committed secrets
- [ ] Pitch deck (shared across all 4 repos, owned by `lively-landing` or a separate deck — 🔴 TBD which repo hosts it)

**Doc sources:** none fetched — all facts above came directly from the user during drafting (2026-07-16).
