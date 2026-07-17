# lively-backend — Build Backlog

> The backend half of Lively (Fastify + Neon Postgres). Derived from [CORE.md](../CORE.md) (schema + API contract, source of truth in this repo), [SPEC.md](../SPEC.md) (MVP scope), [PLAN.md](../PLAN.md) (schedule + cut-order). The mobile backlog lives in `lively-mobile/docs/BACKLOG.md`; the two share the CORE.md contract.

**Priorities:** **P0** demo spine · **P1** credible demo · **P2** polish. Cut-order (PLAN.md): titipan and missed-day alerts drop first, then B10 (performance report); the irreducible core is elder creation, conversation logging, and chair-test recording.

**How to use this file:** work stories in priority order, top to bottom. Tick each acceptance box **in the same PR that satisfies it** — this file is the shared, checkable record of progress. A story is done only when its boxes are ticked *and* its test steps (in [TESTING.md](TESTING.md)) pass. See [../AGENTS.md](../AGENTS.md) for the working agreement.

**2026-07-17 contract reconciliation:** every story below was individually verified against Neon as it landed, but CORE.md's §2 table was never updated to match — stories shipped without the corresponding amendment being applied (see the amendments table further down, now marked ✅ where actually applied). `lively-mobile` had built its client independently against `ANTICIPATED` shapes it had to guess. First local mobile↔backend connection testing surfaced the drift: elders/medications/family-members/auth responses were camelCase while mobile assumed snake_case (matching CORE §7's own convention); several routes didn't exist in the form mobile called them (`GET /medications` took a path param instead of `?elder_id=`, alerts required `elder_id`, resolve and manual-escalate were two routes instead of one, `GET /family-members/me` and `GET /elders/:id/titipan` didn't exist at all). Reconciled by changing the backend to match mobile + CORE §7's snake_case convention (not the other way around — nothing here was ever actually locked, just inconsistently implemented). CORE.md §2 now reflects the real, verified contract. Story-level acceptance boxes below still describe the original per-story tests; where the route/shape changed since, the story's checklist wasn't rewritten line-by-line — CORE.md is the current source of truth for exact shapes.

---

## Epic B0 — Project scaffold `P0`

### B0.1 Fastify + TypeScript skeleton `P0`
- [x] `npm run dev` starts the server on `PORT` from `.env`
- [x] `GET /health` returns `200 {"status":"ok","db":"connected"|"down"}`
- [x] All errors return `{ "error": { "code": string, "message": string } }` — never a raw stack trace
- [x] Unknown routes return 404 in the same error shape
- [x] `.env.example` lists `DATABASE_URL`, `BOT_SERVICE_KEY`, `JWT_SECRET`, `PORT` (already present — keep in sync)

**Test:** `curl /health` → 200; `curl /nope` → 404 with error shape; start without `DATABASE_URL` → clear startup error, not a crash loop. ✅ All verified.
**Depends on:** nothing.

### B0.2 Neon connectivity verified from venue `P0` 🔴
The #1 risk in SPEC §7. Do this before anything else on Day 1.
- [x] Connection to Neon succeeds (verified from dev machine; re-verify from actual venue Wi-Fi on Day 1 per the risk note)
- [x] Fallback rehearsed: local Postgres via Docker (`docker compose up db`), same migrations, connection swap is one env var (local port 5433, not 5432 — this machine already has a local Postgres 17 on 5432)
- [x] `docker-compose.yml` with a Postgres service committed

**Test:** `GET /health` shows `"db":"connected"` on venue network; kill Neon URL, point at local Docker, health goes green again. ✅ Verified against local Docker; venue-network retest still needed on Day 1.
**Depends on:** B0.1.

### B0.3 Migration tool decided + wired `P0`
Resolves the 🟡 in SPEC §5. **Decision: Drizzle ORM + drizzle-kit** — schema-as-code in TypeScript (`src/db/schema.ts`), `drizzle-kit generate` produces committed SQL migration files, `drizzle-kit migrate` applies them. Lighter than Prisma, keeps raw SQL visibility, and the generated query builder still gives route handlers type safety.
- [x] `npx drizzle-kit generate` creates SQL migrations from `src/db/schema.ts`; `npx drizzle-kit migrate` applies them
- [x] Migration files committed (`drizzle/0000_flashy_jubilee.sql`); `npx drizzle-kit migrate` verified against a fresh DB (local Docker Postgres, dropped schema and re-migrated from zero)

**Test:** drop the local DB, run migrations from zero, schema matches CORE.md §1. ✅ Verified via `docker compose` Postgres — schema matches, includes required indexes (B1.1).
**Depends on:** B0.2.

---

## Epic B1 — Schema & seed data `P0`

### B1.1 Full CORE.md schema `P0`
All 10 tables from CORE.md §1 (freeze after Day 1): `elders`, `family_members`, `companions`, `conversations`, `chair_test_results`, `exercise_logs`, `medications`, `medication_logs`, `alerts`, `titipan_messages`.
- [x] Every table + column from CORE.md §1 exists, including enums/checks: `conversations.direction ∈ {in,out}`, `alerts.type ∈ {missed_days, pain_mention, dizziness_mention, medication_missed, no_response, emergency}`, `exercise_logs.method` and `medication_logs.method ∈ {reply, emoji, photo}`, `chair_test_results.source = 'chat'`. Enforced as real Postgres enum types (`pgEnum`), not just TypeScript-level narrowing — a bogus value is rejected by the DB itself, not just the app layer.
- [x] Foreign keys: `elders.family_member_id → family_members`, `elders.companion_id → companions`, child tables → `elders`, `medication_logs.medication_id → medications`
- [x] `elders.health_flags` and `medications.schedule_times` are array columns
- [x] Indexes on hot reads: `conversations(elder_id, created_at)`, `alerts(elder_id, created_at)`, `medication_logs(medication_id, taken_at)`
- [x] Unique constraints added beyond the CORE.md sketch, needed for correctness: `companions.key` (exactly one row per persona — the seed script and any future lookup-by-persona code need this to be safe) and `elders.phone_e164` (`POST /bot/inbound` resolves an elder by phone per CORE.md §2 — without uniqueness that lookup is ambiguous)
- [x] Applied amendments #2 (`family_members.password_hash`) and #4 (`elders.paused`) from below — both are schema changes B2/B3 need, better landed now before the freeze than as a second migration mid-epic

**Test:** migration from zero passes (verified via local Docker, full reset including Drizzle's migration-tracking schema); inserting an alert with a bogus type fails (verified: `ERROR: invalid input value for enum alert_type`); TESTING.md schema checklist.
**Depends on:** B0.3.

### B1.2 Seed script — companions + demo elder `P0`
- [x] `npm run seed` is idempotent (safe to re-run) — guarded by a lookup on `elders.phone_e164` (now unique per B1.1); companions/family member use `onConflictDoNothing` on their own unique columns
- [x] Seeds both companions: `mbak_asih` ("Mbak Asih"), `mas_budi` ("Mas Budi")
- [x] Seeds a demo family member (`demo@lively.app` / `Demo1234!`, hashed with bcryptjs — pick this up in B2.1, don't introduce a second hashing lib) + elder "Eyang Uti" (honorific "Eyang Uti", health flags `["knee_pain"]`)
- [x] Chair-test history: ~4 results climbing 8 → 9 → 11 → 12 (the Progress chart's story arc)
- [x] ~10 seeded conversation messages (mixed in/out) so Chat Monitor isn't empty
- [x] A few exercise logs (streak of 3+) and one active medication ("Amlodipine", `["07:00"]`) with logs

**Test:** run seed twice → no duplicates (verified: second run logs "already seeded, skipping"); row counts verified (2 companions, 1 family member, 1 elder, 4 chair tests, 10 conversations, 4 exercise logs, 1 medication, 3 medication logs); password hash round-trips through bcrypt.compare. `GET /elders/:id/conversation` returning seeded messages and progress showing 8→12 will be verified once B3/B4/B5 routes exist.
**Depends on:** B1.1.

---

## Epic B2 — Auth `P0`

### B2.1 Family register + login (JWT) `P0`
⚠️ **CORE.md gap** (see Amendments): CORE §2 says JWT is "issued by backend" but lists no auth endpoints. Adds `POST /auth/register`, `POST /auth/login`.
- [x] `POST /auth/register` `{email, name, password}` → `family_members` row (hash with `bcryptjs` — decided in B1.2, already a dependency, don't introduce a second hashing lib; `password_hash` column landed in B1.1) → `{token, familyMember}`
- [x] `POST /auth/login` `{email, password}` → `{token, familyMember}`; wrong password → 401 (same message as unknown email, so the endpoint doesn't confirm which emails are registered)
- [x] JWT signed with `JWT_SECRET`, carries `family_member_id`, expiry ≥ 72h (7d, so judges don't get logged out mid-demo)
- [x] Duplicate email on register → 409 with error shape (bug caught in testing: Drizzle wraps the underlying `pg` unique-violation error in a `DrizzleQueryError`, so the real Postgres error code lives on `.cause`, not the top-level error — `isUniqueViolation` walks `.cause` recursively)
- [x] Request validation via zod on both routes → 400 with `fields` detail on bad input (gets B9.1's contract right from the start instead of retrofitting)

**Test:** register → login → decoded token has the right id (verified via curl against Neon); wrong password 401; unknown email 401 with identical message; duplicate email 409; short password 400 with `fields.password`. TESTING.md auth matrix.
**Depends on:** B1.1.

### B2.2 Auth middleware — JWT + bot key `P0`
- [x] `requireFamily` preHandler: validates `Authorization: Bearer <jwt>`, attaches `familyMemberId`; 401 on missing/invalid/expired (verified via Fastify `.inject()` against a throwaway test route: no token, bad token, expired token all 401; valid token 200 with correct `familyMemberId`)
- [x] `requireBot` preHandler: validates `X-Bot-Key` against `BOT_SERVICE_KEY` (constant-time compare); 401 on mismatch (verified: no key, wrong key, and a same-length-but-wrong key — the case that actually exercises `timingSafeEqual` — all 401; correct key 200)
- [x] Route ownership: family routes only touch elders where `elder.family_member_id = familyMemberId`; cross-family → 404 (don't leak existence) — verified in B3 (`getOwnedElder` helper, exercised by all of B3.1-B3.3)
- [x] Route→guard mapping matches CORE §2's Consumer column exactly for the routes that exist so far (`/elders*` → `requireFamily`); re-check this box as each remaining mobile/bot route lands in B4-B8

**Test:** guard mechanics verified in isolation (see above); cross-family 404 verified end-to-end in B3 against Neon (family B reading or patching family A's elder → 404, both by nonexistent-id and wrong-owner paths).
**Depends on:** B2.1.

---

## Epic B3 — Elder management `P0`

### B3.1 `POST /elders` — create `P0`
- [x] Body `{name, honorific, phone_e164, companion_key, health_flags}`
- [x] Validates: honorific non-empty (CORE §3), phone E.164, companion key ∈ {mbak_asih, mas_budi}, health flags known-list with free-text passthrough (implemented as: any non-empty string ≤60 chars, ≤20 flags — there's no canonical known-list in CORE.md/SPEC.md to validate against, so the "known list" is a mobile-side chip picker; backend just accepts free text with sane bounds)
- [x] Creates row linked to the authenticated family member; 201 with the full elder (includes the joined `companion` object, not just `companion_id`, so mobile doesn't need a second call)
- [x] Invalid companion / malformed phone → 400 with field-level detail

**Test:** happy path 201; bad phone 400 with `fields.phone_e164`; bad companion_key 400; no auth 401. All verified via curl against Neon.
**Depends on:** B2.2.

### B3.2 `PATCH /elders/:id` — switch companion / honorific / pause `P0`
- [x] Partial body `{companion_key?, honorific?, health_flags?, paused?}` (`paused` needs a column — see Amendments; CORE §2 lists "pause" as this endpoint's job)
- [x] Only the owning family member can patch; others 404
- [x] Companion switch takes effect on the next bot context read; no past-conversation migration (no conversation rows are touched — the switch is just an FK update)
- [x] Returns the updated elder

**Test:** cross-family patch → 404; owner patch of companion_key + honorific + paused together → 200, all three fields verified persisted via a follow-up GET. Verified against Neon.
**Depends on:** B3.1.

### B3.3 `GET /elders` + `GET /elders/:id` `P0`
⚠️ **CORE.md gap** (Amendments): mobile Home can't render without reading elders back.
- [x] `GET /elders` → the family member's elders, each with companion joined + a status summary (last message at, open alert count)
- [x] `GET /elders/:id` → single elder, 404 if not owned
- [x] New account → `200 []`, not an error

**Test:** new account → `[]` (verified); seeded/created account → elder with companion joined (verified); cross-family → 404 (verified); malformed (non-UUID) id → 404, not a 500 (a raw non-UUID string would otherwise hit Postgres's `uuid` column type and throw — guarded with a format check before the query, verified with `/elders/not-a-uuid` → 404).
**Depends on:** B3.1.

---

## Epic B4 — Conversation log `P0`

### B4.1 `POST /bot/inbound` — log elder message + return companion context `P0`
- [x] Bot-key auth; body `{elder_phone_e164, body}` — backend resolves phone → elder
- [x] Inserts `conversations` row `direction:'in'`
- [x] Response carries the CompanionConfig contract (CORE §3): `{elder_id, companion:{key, honorific, healthFlags}, paused, recent_messages: last 10}`. Note: this response follows CORE.md's literal snake_case field names (`elder_id`, `recent_messages`, `created_at`) since it's a genuine cross-repo contract `lively-bot` codes against directly — unlike the rest of this API (auth, elders), which uses camelCase since CORE.md doesn't specify those field names explicitly.
- [x] Unknown phone → 404
- [x] Paused elder: message still logged, response `paused: true`

**Test:** all verified against Neon with a throwaway elder — known phone → row + context matches CORE §3 shape exactly; unknown phone 404; no/wrong bot key 401; paused elder still logs and returns `paused:true`.
**Depends on:** B2.2, B1.2.

### B4.2 `POST /bot/outbound` — log companion message `P0`
- [x] Bot-key auth; body `{elder_id, body}` → `direction:'out'` row (CORE §4: logs after the fact, no timing enforcement)
- [x] Supports 1–3 message splits: three rapid calls → three ordered rows (`created_at` monotonic)

**Test:** three rapid posts → three ordered rows, timestamps strictly increasing (verified against Neon); unknown elder_id → 404.
**Depends on:** B4.1.

### B4.3 `GET /elders/:id/conversation` — Chat Monitor read `P0`
- [x] Family JWT + ownership
- [x] `?limit=30&before=<cursor>` — newest first, `before` pages older
- [x] Response `{messages:[{id, direction, body, created_at}], next_cursor}`
- [x] Empty conversation → `{messages:[], next_cursor:null}`
- [x] `?after=<cursor>` returns only newer messages (poll-friendly), oldest-first so a client can append in order

**Test:** paged with `before` (2-message pages, no overlap/gap, verified against Neon); `after` returns only new rows following a bot inbound; empty `[]` for a fresh elder; cross-family → 404; unknown cursor → 400; both `before`+`after` → 400.

**Bug caught and fixed during testing:** the cursor comparison originally fetched a message's `created_at` into JS as a `Date`, then reused that `Date` as the comparison bound. JS `Date` only has millisecond precision; Postgres `timestamptz` has microsecond precision. So a message's own truncated timestamp could compare as "less than" its own untruncated stored value, and `after=<a message's own id>` would incorrectly include that message in its own results (proved with `after=oldest_id` returning all 5 rows instead of 4). Fixed by moving the comparison into a SQL subquery (`created_at > (SELECT created_at FROM conversations WHERE id = ...)`) so it never round-trips through a JS `Date`. Re-verified: `after=oldest_id` now correctly excludes itself, and `after=<latest known id>` with nothing new returns `{messages:[],next_cursor:null}`.
**Depends on:** B4.1, B4.2.

---

## Epic B5 — Assessments & exercise `P0`

### B5.1 `POST /assessments/chair-test` `P0`
- [x] Bot-key auth; body `{elder_id, reps:int, recorded_at?}`; `source` fixed `'chat'`
- [x] `reps` sanity-bounded 0–60; out of range → 400
- [x] 201 with the row

**Test:** valid 201; `reps:200` → 400 with `fields.reps`; `reps:-1` → 400; unknown elder → 404; shows in B5.3 (verified against Neon).
**Depends on:** B2.2.

### B5.2 `POST /exercise-logs` `P0`
- [x] Bot-key auth; body `{elder_id, method, completed_at?}`
- [x] One log per elder per day (idempotent); duplicate same-day → 200 existing row. Day boundary is UTC calendar day, not each elder's local Indonesian timezone (WIB/WITA/WIT) — the schema has no per-elder timezone column and none was requested; a deliberate simplification, not an oversight.

**Test:** two posts same day → one row, same id, second returns 200 not 201 (verified against Neon); explicit `completed_at` on a different day → new row, 201.
**Depends on:** B2.2.

### B5.3 `GET /elders/:id/progress` — Progress aggregate `P0`
⚠️ **CORE.md gap** (Amendments): SPEC §3 promises "backend aggregates → mobile renders" but no read endpoint exists. One aggregate call = one mobile skeleton. Also the data source for the gamification screen (CORE.md §7): progress bar, streak, and graphs.
- [x] Family JWT + ownership
- [x] Response matches the CORE.md §7 shape (`overall_progress_pct`, `engagement_streak_days`, `chair_tests`, `exercise`, `exercise_history`, `medication_adherence`, `medication_adherence_trend`)
- [x] Chair tests oldest→newest (chart-ready), capped last 20
- [x] `exercise_history` and `medication_adherence_trend`: last 30 days, oldest→newest (chart-ready)
- [x] `overall_progress_pct` = average of `latest_reps/15*100`, `current_streak_days/7*100`, `last7d_taken/last7d_scheduled*100`, each capped at 100 (CORE.md §7 — tuning constants, keep in sync with mobile). Refinement made while implementing: if an elder has zero active medications, `last7d_scheduled` is 0 — the medication component is excluded from the average (not divided by zero, not penalized) rather than the formula silently producing `NaN`.
- [x] `engagement_streak_days` = consecutive calendar days with ≥1 of {exercise_logs, medication_logs, chair_test_results} row (broader than `exercise.current_streak_days`)
- [x] Zero-data elder → zeros/empty arrays, 200
- [x] Streaks use a one-day grace: if today has no activity yet, the streak counts from yesterday backward instead of zeroing out just because today isn't over.
- [x] `unconfirmed_today` limitation, documented in code: `medication_logs` has no slot column, so on a partial day (e.g. 1 of 2 doses confirmed) the endpoint can't know *which* slot is still open — it takes the trailing N-unconfirmed `schedule_times` as a deterministic stand-in. Exact for the common single-dose-per-day case (matches the seed data); a real gap for multi-dose meds, worth a schema fix (a slot/scheduled-time column on `medication_logs`) if B6 needs it precisely.

**Test:** verified against the real seeded Eyang Uti data on Neon, math checked by hand: chair score `12/15*100=80`, exercise score `4/7*100≈57.14`, medication score `3/7*100≈42.86`, average `60` — matches the endpoint's `overall_progress_pct:60` exactly. `engagement_streak_days`, `unconfirmed_today` (`["Amlodipine 07:00"]`), and both 30-day history arrays all independently verified correct. Fresh elder → all-zero/empty shapes, `overall_progress_pct:0`, still 200. Cross-family access → 404.
**Depends on:** B5.1, B5.2 (adherence block lands with B6.2 — but the seed script already writes medication_logs directly, so this was fully testable now).

---

## Epic B6 — Medications `P1`

### B6.1 `POST /medications` + `PATCH /medications/:id` + `GET /elders/:id/medications` `P1`
⚠️ **CORE.md gap** (Amendments): SPEC §4 says "adds/**edits**"; mobile needs the list.
- [x] `POST` (family JWT) `{elder_id, name, dosage, schedule_times:["07:00"], active?}` — times `HH:MM`, ≥1
- [x] `PATCH /medications/:id` partial incl. `active:false` (soft-disable, never delete — logs reference it)
- [x] `GET /elders/:id/medications` — active meds with today's per-slot status (`taken`/`unconfirmed`/`upcoming`)
- [x] Ownership checks throughout

**Test:** create → list shows with slots (verified: 07:00 "unconfirmed", 19:00 "upcoming" against current UTC time); deactivate → drops from `GET .../medications` and from `progress`'s `last7d_scheduled`, but the medication_log history stays and still counts in `last7d_taken` (verified); bad time (`"25:99"`) → 400 with `fields`; cross-family PATCH → 404. All verified against Neon.
**Depends on:** B3.3.

### B6.2 `POST /medication-logs` `P1`
- [x] Bot-key auth; body `{medication_id, elder_id, method, taken_at?}`
- [x] Validates medication belongs to elder; mismatch → 400
- [x] Idempotent per medication (see limitation below); double-post same day → 200 existing row, same id
- [x] Feeds B6.1 status + B5.3 adherence

**Known limitation, deliberate not accidental:** "idempotent per medication + slot" as originally speced needs a `scheduled_time`/slot column on `medication_logs` to know *which* dose a log confirms — that column doesn't exist, and CORE.md's schema froze at the end of Day 1. Adding it now would mean a contract change `lively-bot` would need to adopt mid-hackathon, which is exactly the kind of late schema churn SPEC.md's risk section warns against. Shipped as idempotent **per medication per UTC calendar day** instead: exactly correct for the single-dose-per-day case (the seed data, and the likely demo path), but a second same-day dose on a multi-dose medication (e.g. Amlodipine at both 07:00 and 19:00) will under-confirm — the second post returns the first log's row rather than creating a new one. Same root cause as B5.3/B6.1's `unconfirmed_today`/slot-status heuristics.

**Test:** log → list flips 07:00 to `taken` (verified); double-post same day → same id, 200 not 201 (verified); medication/elder mismatch → 400 (verified); unknown medication → 404 (verified). All against Neon.
**Depends on:** B6.1.

### B6.3 Missed-dose detection → `medication_missed` alert `P1`
CORE §5: no confirmation within grace (default 2h) just shows unconfirmed; **2 consecutive misses** raise `medication_missed`. Counting misses across days is backend state so the bot stays stateless.
- [x] A slot with no log 2h past its time counts as missed — **lazily on read**, triggered from `GET /elders/:id/medications` (the natural, already-existing read point for medication state; cheap at hackathon data volume, avoids standing up a scheduler for one P1 story)
- [x] 2 consecutive missed slots → one `medication_missed` via the B7.1 path (fires once, not per-read) — literally calls `raiseAlert`, the function extracted from `POST /alerts`'s own insert+dedup+push logic, not a re-implementation. Its 30-min dedup window means a *persisting* miss streak could re-alert after 30 min of continued misses on a later read; that's arguably reasonable (a days-long streak probably should re-nudge), but it's a different guarantee than "fires exactly once ever per streak" — noted, not silently assumed away.
- [ ] Grace window + consecutive threshold are per-elder-overridable constants (defaults 2h / 2) — the *defaults* are shipped and correct (`GRACE_MS`, `CONSECUTIVE_THRESHOLD` in `src/lib/missed-doses.ts`), but per-elder overridability is not: no column exists to store an override and no product requirement specified what one would look like. A half-built override mechanism nobody can drive isn't better than a documented fixed default — left honestly unticked rather than claimed done.
- [x] "Slot" reuses the same trailing-N-taken heuristic as B5.3/B6.1/B6.2 (no slot column on `medication_logs` — see B6.2): a day's logs are matched to that day's earliest scheduled occurrences in order. Exact for single-dose-per-day medications (the seed data); approximate for multi-dose ones.

**Test:** fresh medication with `["07:00"]` and zero logs, checked when current time is well past today's grace window → both today's and yesterday's occurrences are misses → `medication_missed` alert exists (verified against Neon). A medication with today's dose logged (only yesterday missed, 1 miss not 2) → no alert (verified). Demo elder's real Amlodipine data (logged 3/2/1 days ago, not today — exactly 1 miss) → confirmed no spurious alert.
**Depends on:** B6.2, B7.1.

---

## Epic B7 — Alerts & escalation `P1`

### B7.1 `POST /alerts` — all six types `P1`
- [x] Bot-key auth; body `{elder_id, type, payload}`; `type` ∈ the six enum values
- [x] `payload` carries type context (e.g. `{quote:"lutut saya sakit sekali"}`) stored as JSON, echoed to mobile
- [x] Fan-out: targets **every** family member linked to the elder — no hardcoded single recipient (CORE §6). Written as a proper multi-row query (`WHERE family_members.id = elder.family_member_id`), not a single-row lookup — but honestly noted: `elders.family_member_id` is a single FK today, so this always resolves to at most one recipient in practice. True multi-caregiver needs a join table, which SPEC.md explicitly calls a non-goal at MVP. Not overclaiming fan-out the schema doesn't yet support.
- [x] Duplicate suppression: same elder + type within 30 min → 200 existing, no re-push

**Test:** pain_mention with payload → 201, payload echoed; bogus type → 400; duplicate within window → 200, same row, original payload preserved (second call's payload ignored). All verified against Neon.
**Depends on:** B2.2.

### B7.2 Push trigger (Expo) `P1`
SPEC §6 leaves *delivery* to mobile, but something must call Expo Push when an alert lands, and the backend is the only party that sees every alert at creation. **Decision: backend POSTs to `https://exp.host/--/api/v2/push/send` directly** using `family_members.push_token`; mobile's job (M8.1) is registering the token. Polling is the fallback if push flakes.
- [x] On alert insert: for each linked family member with a `push_token`, POST type-tiered copy (UI-UX §5: `emergency`/`pain_mention`/`dizziness_mention` = urgent + max priority + sound; `medication_missed`/`no_response` = default priority gentle nudge; `missed_days` = neutral info)
- [x] Push failure never fails the alert insert (fire-and-forget, logged error)
- [x] `PATCH /family-members/me` accepts `{push_token}` (⚠️ Amendment — mobile needs a write path)

**Bug caught and fixed during testing:** Expo's push API returns **HTTP 200 even for a dead/invalid token** — the actual failure is a per-message `status:"error"` ticket inside the JSON body, not the HTTP status. The initial implementation only checked `response.ok`, so a dead token would silently report success and never log anything, missing exactly the failure case this story's own test asks for ("dead token → alert still 201" implies the failure is still detected and logged, just non-blocking). Verified directly against Expo's real endpoint with a fake token to confirm the response shape, then fixed `sendAlertPush` to parse `data[].status` and log ticket-level errors too.

**Test:** no `push_token` set → no HTTP call attempted (verified via clean log); `push_token` set to a fake Expo token → alert insert still returns 201 immediately (not blocked on the push round-trip), and the ticket-level failure appears in the log shortly after. No real Expo device available in this environment, so true end-to-end delivery to a physical device is unverified — the failure-doesn't-block-and-gets-logged contract is what's actually tested.
**Depends on:** B7.1.

### B7.3 `GET /alerts` + `PATCH /alerts/:id/resolve` `P1`
⚠️ **CORE.md gap** (Amendments): schema has `resolved_at`; mobile must list + resolve.
- [x] `GET /alerts?elder_id=&unresolved_only=true` (family JWT, ownership) — newest first, includes payload
- [x] `PATCH /alerts/:id/resolve` sets `resolved_at`; already-resolved → 200 idempotent (second call returns the original `resolved_at`, doesn't overwrite it)
- [x] Manual-urgent (CORE §6): `PATCH /alerts/:id {type:'emergency'}` lets family escalate — deliberately narrow (only accepts `{type:'emergency'}`, not a general PATCH), re-triggers the push fan-out since escalating should re-notify

**Test:** raise → unresolved list (3) → resolve → resolve again (idempotent, same `resolved_at`) → unresolved list drops to 2 (verified against Neon). Manual escalation flips a `pain_mention` to `emergency` and re-pushes; invalid escalation body (`{type:'missed_days'}`) → 400. Cross-family `GET /alerts` → 404.
**Depends on:** B7.1.

---

## Epic B8 — Titipan (family relay) `P2`

### B8.1 `POST /elders/:id/titipan` `P2`
- [x] Family JWT + ownership; body `{body}` (≤500 chars); inserts `delivered_at:null`
- [x] 201 `{id, body, delivered_at:null}` (full row returned, a superset of the documented shape)

**Schema gap found and fixed:** `titipan_messages` had no `created_at` column (matching CORE.md's original sketch), but B8.2 needs "undelivered oldest-first" ordering and UUIDs (`gen_random_uuid()`) aren't chronologically sortable — there was no way to implement "oldest-first" correctly without one. Added `created_at timestamptz not null default now()` via a new migration (table was empty, applied to Neon and verified from a fully-reset local DB). Purely additive and internal: doesn't change what `lively-bot`/`lively-mobile` need to send, so safe post-freeze. Mirrored to `lively-mobile/CORE.md`.

### B8.2 Bot delivery queue `P2`
⚠️ **CORE.md gap** (Amendments): the bot must fetch undelivered titipan and mark them sent.
- [x] `GET /bot/titipan-queue?elder_id=` (bot key) → undelivered oldest-first
- [x] `PATCH /bot/titipan/:id/delivered` sets `delivered_at`; idempotent (second call returns the original `delivered_at`, doesn't overwrite it)

**Test:** two sends → queue shows both, oldest first (verified against Neon); mark first delivered → drops from queue, second call idempotent; unknown elder on queue fetch → 404; unknown titipan on delivered mark → 404; cross-family send → 404.
**Depends on:** B8.1.

---

## Epic B9 — Demo hardening `P1`

### B9.1 Validation everywhere `P1`
- [x] Every route body/params validated (zod); no unvalidated input reaches a query — audited systematically (grepped every `request.params`/`request.body`/`request.query` access across all 10 route files, confirmed each one goes through `parseBody`/`parseQuery` or an ownership helper that validates UUID format before querying — not just assumed from having written it that way)
- [x] Validation errors → 400 `{error:{code:'VALIDATION', message, fields:{...}}}`

**Bug caught and fixed during the audit:** Fastify's own body-parsing errors (malformed JSON, empty body with a JSON content-type, missing/wrong content-type) bypass the zod layer entirely and were leaking Fastify's internal `FST_ERR_CTP_*` codes at various status codes (400, 415) instead of the standardized `VALIDATION`/400 shape this story requires. Verified with curl against all four cases (malformed JSON, empty body, no content-type, no body at all), then normalized them in the global error handler (`server.ts`) — one place, not a per-route fix — so any `FST_ERR_CTP_*` code becomes a clean `{error:{code:'VALIDATION',message:'Invalid request body'}}` at 400. Re-verified all four cases plus a regression check that normal zod validation errors, 401s, and 404s were untouched by the change.

### B9.2 CORS + logging `P1`
- [x] CORS open to Expo dev origins (`*` acceptable — SPEC §6 waives abuse protection) — `@fastify/cors` with `origin: true` (reflects the request's Origin rather than a literal `*`, which also works if credentialed requests are ever needed later). Verified: preflight `OPTIONS` returns 204 with `access-control-allow-origin` matching the request's Origin; a normal `GET` carries the same header.
- [x] Request logging (pino) with route + status + latency — already present since B0 (`Fastify({logger:true})`); verified the actual log lines carry `req.url` (route), `res.statusCode`, and `responseTime`, correlated by `reqId`. No code change needed, just confirmed rather than assumed.

### B9.3 Deployed and reachable `P1`
🔴 **Requires your action, not something I can do unattended.** Deploying to Railway/Render/Fly means creating or using a cloud account, which needs your credentials/access — I can walk through the steps with you (or use gstack's `/setup-deploy` skill once a platform is chosen), but I'm not going to sign up for a hosting account or push infrastructure changes to a shared external system on your behalf without you present for it.
- [ ] Deployed (Railway / Render / Fly) with env vars set
- [ ] `GET /health` green from a phone on cellular (the demo-day network escape hatch)
- [ ] `BACKEND_API_URL` shared with mobile + bot teams

**Test:** full TESTING.md smoke script against the deployed URL from a phone hotspot.
**Depends on:** everything P0.

---

## Epic B10 — Performance report `P1` 🟡 first-in-line to cut
Post-kickoff addition (mentor/judge feedback: gamification makes checking on Eyang feel like a shared win, not a compliance chore). The progress bar/streak/graphs in B5.3 already deliver most of that value cheaply — this epic is the one genuinely new endpoint, so it's the first thing to drop if Day 3 runs short (PLAN.md cut-order).

### B10.1 `GET /elders/:id/report?period=week|month` `P1`
- [x] Family JWT + ownership; `period` defaults to `week`
- [x] Response matches CORE.md §7 shape: `period`, `range`, `headline`, `consistency_pct`, `exercise`, `medication_adherence_pct`, `chair_test_trend`, `highlights[]`, `areas_needing_support[]`
- [x] `consistency_pct` = % of days in range with ≥1 engagement row (same definition as B5.3's streak, windowed) — `month` is a rolling 30-day window, not a calendar month, matching the same convention already used by B5.3's `exercise_history`/`medication_adherence_trend`, not a second definition of "period"
- [x] `chair_test_trend` ∈ `improving`/`stable`/`declining`, comparing first vs. last chair-test result in range. Fewer than 2 chair tests in range → `stable` (can't claim a direction from 0-1 points; also the most neutral/positive-safe default)
- [x] Copy tone: `headline` and `highlights` always lead positive (highlights are opt-in per category — only added when there's genuinely good news, never spun from a bad number); `areas_needing_support` is encouragement-framed, never guilt. Kept intentionally generic ("could use a nudge on medication doses," not day-pinpointed) — `medication_logs` has no slot column to know which specific day/dose, same limitation as B5.3/B6.
- [x] Zero-data elder → `consistency_pct: 0`, empty arrays, still 200 with a gentle headline (`"{honorific} is just getting started"`) — `medication_adherence_pct` is `null` in this case (and whenever an elder has no active medications), not a fabricated number

⚠️ **Worth a second look:** `highlights`/`areas_needing_support`/`headline` copy is in **English**, matching CORE.md §7's literal JSON example verbatim — even though the rest of the product (companion chat copy, `UI-UX-GUIDELINES.md` §4) is Indonesian-first. I followed the documented contract exactly rather than deviate on my own judgment, but this is a real product decision someone should confirm before the demo, not something to discover live.

**Test:** verified against the real seeded Eyang Uti data on Neon, math checked by hand — week: `consistency_pct = round(5/7×100) = 71` (only 1 of 4 seeded chair tests falls in a 7-day window, correctly triggering the `stable` fallback and its highlight), `medication_adherence_pct = round(3/7×100) = 43`; month: all 4 chair tests in range → `improving`, `8→12`, different `consistency_pct` (27) and `range`. Fresh elder → zero-state copy, `medication_adherence_pct: null`, empty arrays, still 200. Invalid `period` → 400. Cross-family → 404.
**Depends on:** B5.3.

---

## Contract stubs — other repos consume these (not built here)

So nothing in CORE.md is orphaned:

| Consumer | Contract | Backed by |
|---|---|---|
| `lively-bot` | Human Texting Engine (CORE §4): split 1–3 msgs, typing indicator, ≥2s delay, randomized morning window | Logs via B4.1/B4.2 — backend stores, never enforces timing |
| `lively-bot` | Companion context fetch per inbound (CORE §3 interface) | B4.1 response shape |
| `lively-bot` | Reminder cron per `schedule_times`; parse casual confirmations | Reads B6.1, logs B6.2; consecutive-miss counting is backend's (B6.3) |
| `lively-bot` | Pain/dizziness/emergency detection → immediate alert; `no_response` after 12h silence | B7.1 |
| `lively-bot` | Titipan delivery in persona voice | B8.2 queue |
| `lively-mobile` | Every endpoint above under family JWT | this backlog |
| `lively-landing` | Static page, no API dependency today | — |

---

## Proposed CORE.md amendments

CORE.md's rule: schema/endpoint changes update all four repo copies, no local workarounds. Apply these to CORE.md §1/§2 in all four repos **at kickoff, before the Day-1 freeze** — the backend can't be built to contract without them.

| # | Change | Why | Story |
|---|---|---|---|
| 1 | ✅ Add `POST /auth/register`, `POST /auth/login` (applied in B2.1) | JWT "issued by backend" with no issuing endpoint | B2.1 |
| 2 | ✅ Add `family_members.password_hash` (applied in B1.1) | No credential storage in schema | B2.1 |
| 3 | ✅ Add `GET /elders`, `GET /elders/:id` (applied in B3.3) | Mobile Home can't render without reading elders | B3.3 |
| 4 | ✅ Add `elders.paused boolean default false` (applied in B1.1) | §2 lists "pause" but schema has no column | B3.2 |
| 5 | ✅ Add `GET /elders/:id/progress` (applied in B5.3) | SPEC §3 promises aggregate; no read endpoint | B5.3 |
| 6 | ✅ Add `PATCH /medications/:id`, `GET /medications?elder_id=` (applied in B6.1, route form reconciled with mobile 2026-07-17) | SPEC §4 says "edits"; mobile needs the list | B6.1 |
| 7 | ✅ Add `GET /alerts`, `PATCH /alerts/:id/resolve` (applied in B7.3; consolidated into `PATCH /alerts/:id` and `elder_id` made optional on the list during reconciliation 2026-07-17 — see CORE.md §2) | Schema has `resolved_at`; mobile must list + resolve | B7.3 |
| 8 | ✅ Add `PATCH /family-members/me` (push_token) (applied in B7.2; `GET /family-members/me` also added during reconciliation 2026-07-17, mobile needs a read path too) | `push_token` column has no write path | B7.2 |
| 9 | ✅ Add `GET /bot/titipan-queue`, `PATCH /bot/titipan/:id/delivered` (applied in B8.2; `GET /elders/:id/titipan` family list also added during reconciliation 2026-07-17 — the bot queue is undelivered-only, mobile needs full history) | `delivered_at` has no way to be set | B8.2 |
| 10 | ✅ Note in §2: `POST /bot/inbound` response carries CompanionConfig + `paused` + recent messages (applied in B4.1) | Bot needs context in the same round-trip | B4.1 |

---

## Traceability — CORE.md → story

| CORE.md item | Stories |
|---|---|
| §1 tables ×10 | B1.1, seeds B1.2 |
| §2 `POST /elders` · `PATCH /elders/:id` | B3.1 · B3.2 |
| §2 `GET /elders/:id/conversation` | B4.3 |
| §2 `POST /elders/:id/titipan` | B8.1 |
| §2 `POST /bot/inbound` · `/bot/outbound` | B4.1 · B4.2 |
| §2 `POST /assessments/chair-test` | B5.1 |
| §2 `POST /exercise-logs` | B5.2 |
| §2 `POST /medications` · `/medication-logs` | B6.1 · B6.2 |
| §2 `POST /alerts` (6 types) | B7.1 |
| §2 `GET /elders/:id/progress` · `/report` | B5.3 · B10.1 |
| §2 auth model (JWT + BOT_SERVICE_KEY) | B2.1, B2.2 |
| §3 CompanionConfig contract | B4.1 (shape) |
| §4 Human Texting Engine | Bot stub; B4.2 supports splits |
| §5 Medicine reminder (grace 2h, 2-miss alert) | B6.3, bot stub |
| §6 pain/dizziness immediate · no_response 12h · emergency · fan-out | B7.1, B7.2; detection = bot stub |
| §7 progress bar · streak · graphs · performance report | B5.3, B10.1 |
| Config & secrets | B0.1 (.env.example), B9.3 |
| SPEC §8 submission gate | [SUCCESS-CRITERIA.md](SUCCESS-CRITERIA.md) §3 |
