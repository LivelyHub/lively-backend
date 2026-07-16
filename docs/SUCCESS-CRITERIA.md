# lively-backend — Success Criteria

> What "done" means for the backend at three levels: per epic (§1), for the integration the demo needs (§2), and for submission (§3). Story-level acceptance boxes live in [BACKLOG.md](BACKLOG.md). "Verified" = the [TESTING.md](TESTING.md) procedure was actually run.

## 1. Definition of Done per epic

| Epic | Done when |
|---|---|
| **B0 Scaffold** | Server boots from `.env`; `/health` reports DB status; all errors use the standard shape; Neon reachable from venue Wi-Fi **or** Docker fallback rehearsed; migrations run from zero. |
| **B1 Schema & seed** | All 10 CORE.md tables migrate from empty (verified on Neon and a from-zero local Docker DB); enum/FK/unique constraints reject bad data (verified: bogus enum value and duplicate `companions.key` both rejected by Postgres); `npm run seed` is idempotent (verified: second run is a no-op) and produces Eyang Uti with the 8→12 chair-test arc, conversation history, streak, and one medication. |
| **B2 Auth** | Register/login issue working JWTs (verified against Neon); duplicate email 409, wrong/unknown-email login 401 with identical copy, bad input 400 with field detail. `requireFamily`/`requireBot` guards verified in isolation. Full per-route auth matrix and cross-family 404s land once B3 exists to test against. |
| **B3 Elders** | Create, read (list + single), and patch work end-to-end (verified against Neon: create, list, single, patch, cross-family 404 on both read and patch, malformed-id 404). Pause flag persists and will round-trip into `POST /bot/inbound` responses once B4.1 lands. |
| **B4 Conversation** | Bot logs in/out messages (verified against Neon, including monotonic ordering on rapid outbound posts); history pages with `before` (no overlap/gap), deltas poll with `after` (a real precision bug was caught and fixed here — see BACKLOG.md B4.3); a curl-posted inbound appears in a `GET /conversation` within the poll window. |
| **B5 Assessments** | Chair tests (0-60 bounded) and exercise logs insert (exercise idempotent per day, verified against Neon); `GET /progress` returns chart-ready data plus `overall_progress_pct` and `engagement_streak_days` (CORE.md §7) — hand-verified against the real seeded Eyang Uti numbers, not just spot-checked; empty elder returns all-zero shapes, not errors. |
| **B6 Medications** | Family CRUD + per-slot today status works; dose-logging idempotent per slot; 2 consecutive missed slots raise exactly one `medication_missed`. |
| **B7 Alerts** | All 6 types insert with duplicate suppression; a real Expo push arrives on a device for `emergency`; list + resolve work; fan-out queries the relationship. |
| **B8 Titipan** | Send → bot queue → mark delivered round-trips; `delivered_at` set. |
| **B9 Hardening** | Every route validates input (400s with field detail); deployed URL passes the full smoke script from a phone on cellular. |
| **B10 Performance report** | `GET /report?period=week\|month` returns the CORE.md §7 shape with correct trend/consistency math; zero-data elder gets a gentle 200, not an error. First cut if Day 3 runs short. |

## 2. Integration success (what lets the team demo)

The backend qualifies the whole team, per PLAN.md Definition of Done items 3–4. It is integration-ready when:

- [ ] `lively-mobile` can register, create an elder, and read a conversation + progress against the deployed URL
- [ ] `lively-bot` (or the operator curl script in TESTING.md §3) can log inbound/outbound messages, post a chair test, and raise an alert
- [ ] A `pain_mention` alert posted by the bot path fires an Expo push that lands on the family device — the demo's magic moment (full script in `lively-mobile/docs/SUCCESS-CRITERIA.md` §2)
- [ ] The deployed URL is green from cellular, and `BACKEND_API_URL` is shared with both other teams

## 3. Submission gate (SPEC §8)

- [ ] **Working demo** — deployed backend reachable by mobile + bot at demo time
- [ ] **Public repo** — README, LICENSE, `.gitignore`, `.env.example` only. Before every push, grep for leaked secrets: no `DATABASE_URL=postgres://…`, no real `BOT_SERVICE_KEY`/`JWT_SECRET` values
- [ ] **CORE.md sync** — the [BACKLOG.md](BACKLOG.md) amendments applied to all four CORE.md copies; the committed schema matches CORE.md §1 exactly
- [ ] **Pitch deck** — 🔴 owner TBD (SPEC §8); backend owner confirms who hosts it by Day 2 evening
- [ ] Submitted **with margin** before 2026-07-18 (exact time 🔴 TBD — record it here once known: ______)
