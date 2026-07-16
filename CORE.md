# CORE — Lively Shared Data & API Layer

> This doc is duplicated verbatim across all four Lively repos: `lively-landing`, `lively-mobile`, `lively-backend`, `lively-bot`. `lively-backend` is the source of truth (it owns the schema and API). If this changes, update all four copies.

Lively has one shared foundation underneath four different surfaces: a marketing site, a family-facing mobile app, a REST/data backend, and a WhatsApp companion bot. All four agree on the same data model (elders, companions, conversations, assessments, alerts) and the same API contract served by `lively-backend`. The landing page is the lightest consumer (mostly static, no auth) — it's included here for consistency, not because it calls the API directly today.

## What the core provides (and what it does NOT)

**Provides:**
- Postgres (Neon) schema: elders, family members, companion configs, conversation messages, chair-test results, exercise completions, medications, medication logs, alerts.
- REST API (Fastify, `lively-backend`) that `lively-mobile` and `lively-bot` both read/write through — neither repo talks to the DB directly.
- Auth model: family members authenticate via the backend; `lively-bot` authenticates as a trusted service (API key), not a user.
- Companion persona contract: two fixed personas (Mbak Asih, Mas Budi), parameterized only by honorific + health flags — the shape both backend (storage) and bot (execution) agree on.
- Human Texting Engine contract: the message-splitting/typing-delay behavior `lively-bot` must implement, documented here so mobile/backend expectations (e.g. "a reply never lands in under ~2s") stay in sync.
- Medicine reminder contract: recurring per-elder medication schedule the companion nags about daily, same channel as exercise check-ins.
- Safety escalation contract: any pain/dizziness mention, or no reply from the elder within a defined window, raises an alert that pushes straight to the family member — the "something happened to Eyang" case.
- Gamification & family-reporting contract: progress bar, engagement streak, chart-ready history, and a weekly/monthly performance report — turns raw logs into something a grandchild wants to check, not a chore. See §7.

**Does NOT provide** (lives in each repo): UI/UX, the actual LLM prompt text, WhatsApp webhook handling, push notification delivery, page design. A repo implements these interfaces; it does not fork them. Needing a new field or endpoint = a change to this doc (and all four copies), not a local workaround.

## Details

### 1. Data model — Postgres on Neon

```
elders            (id, family_member_id, name, honorific, companion_id, health_flags[], phone_e164[unique], paused, created_at)
family_members    (id, email, name, password_hash, push_token, created_at)
companions        (id, key['mbak_asih'|'mas_budi'][unique], display_name, system_prompt_ref)
conversations     (id, elder_id, direction['in'|'out'], body, created_at)
chair_test_results(id, elder_id, reps, recorded_at, source['chat'])
exercise_logs     (id, elder_id, completed_at, method['reply'|'emoji'|'photo'])
medications       (id, elder_id, name, dosage, schedule_times[], active, created_at)
medication_logs   (id, medication_id, elder_id, taken_at, method['reply'|'emoji'|'photo'])
alerts            (id, elder_id, type['missed_days'|'pain_mention'|'dizziness_mention'|'medication_missed'|'no_response'|'emergency'], payload, created_at, resolved_at)
titipan_messages  (id, elder_id, family_member_id, body, delivered_at)
```

### 2. API contract (Fastify, `lively-backend`)

| Endpoint | Consumer | Purpose |
|---|---|---|
| `POST /elders` | mobile | create elder + pick companion + honorific + health flags |
| `PATCH /elders/:id` | mobile | switch companion / honorific / pause |
| `GET /elders/:id/conversation` | mobile | chat monitor read |
| `POST /elders/:id/titipan` | mobile | family relay message |
| `POST /bot/inbound` | bot | log inbound WhatsApp message, fetch companion context |
| `POST /bot/outbound` | bot | log outbound message after send |
| `POST /assessments/chair-test` | bot | record parsed chair-test result |
| `POST /exercise-logs` | bot | record daily completion |
| `POST /medications` | mobile | family adds/edits a routine medication for the elder |
| `POST /medication-logs` | bot | record a taken/confirmed dose from a chat reply |
| `POST /alerts` | bot | raise pain/dizziness/missed-day/no-response/emergency alert → triggers push |
| `GET /elders/:id/progress` | mobile | progress bar %, engagement streak, and chart-ready history (chair tests, exercise, medication adherence) — see §7 |
| `GET /elders/:id/report?period=week\|month` | mobile | family-facing performance summary — see §7 |

Auth: mobile uses family member JWT (issued by backend). Bot uses a static `BOT_SERVICE_KEY` header — service-to-service, not a user session.

### 3. Companion persona contract

```ts
interface CompanionConfig {
  key: "mbak_asih" | "mas_budi";
  honorific: string;        // e.g. "Eyang Uti" — never a bare first name
  healthFlags: string[];    // e.g. ["knee_pain", "hypertension"]
}
```
The system prompt text itself lives in `lively-bot` (not shared as data) — this interface is only the parameters that vary per elder.

### 4. Human Texting Engine contract (`lively-bot` implements, others assume)

- Typing indicator before every outbound message; duration ≈ message length / (30–50 chars/sec), capped ~8s.
- Output split into 1–3 short messages, each sent with its own typing pause.
- No reply lands in under ~2s from trigger.
- Morning check-ins sent at a randomized time in a window (e.g. 06:30–07:00), not a fixed second.

| Repo | Implementation | Notes |
|------|----------------|-------|
| lively-bot | Python middleware: split → typing indicator → delay → send | Meta WhatsApp Cloud API `typing_indicator` message |
| lively-backend | none — logs messages after the fact | does not enforce timing |
| lively-mobile | none — reads finished conversation | no timing concern |

### 5. Medicine reminder contract

- Each active `medications` row has one or more `schedule_times` (e.g. `["07:00", "19:00"]`) — the companion sends a reminder through the same Human Texting Engine at each scheduled time, honorific included, same as an exercise check-in.
- A confirmation in any casual form ("sudah minum obat", 👍, a photo of the pill) logs a `medication_logs` row via `POST /medication-logs`.
- No confirmation within a grace window (🟡 default 2h, tune per elder) → does NOT itself raise an alert (elders forget to reply, not necessarily forget the dose) — it just shows as unconfirmed on the Progress screen. Repeated misses (🟡 default 2 consecutive) raises a `medication_missed` alert.

### 6. Safety escalation contract ("something happened to Eyang")

- `pain_mention` / `dizziness_mention`: `lively-bot`'s LLM layer detects these in the elder's own words and raises the alert immediately — never waits for the next scheduled check-in.
- `no_response`: if the elder doesn't reply to a direct check-in (morning greeting or exercise prompt) within a defined window (🟡 default 12h), `lively-bot` raises `no_response`. This is a softer signal than `emergency` — pushes to family as "no reply from Eyang today, worth a call."
- `emergency`: reserved for an explicit distress signal (elder texts something alarming — a fall, can't get up, chest pain) or family manually marking an alert as urgent from the app. Distinct from `no_response` because it pushes immediately and with higher urgency copy, not just a nudge.
- All four alert types share one delivery path: `POST /alerts` → backend stores it → triggers a push to every `family_members` row linked to that elder (not just the one who set up the companion, if multiple caregivers exist — 🟡 multi-caregiver support itself is a non-goal at MVP per each repo's SPEC, but the alert fan-out should not hardcode a single recipient).

### 7. Gamification & family-reporting contract

Driven by mentor/judge feedback: makes checking in on Eyang feel like watching progress, not monitoring a chore. No new tables — everything here is computed from `chair_test_results`, `exercise_logs`, `medication_logs`, `medications` at read time.

**Progress bar** (`GET /elders/:id/progress` → `overall_progress_pct`, 0–100): unweighted average of three sub-scores, each capped at 100:
- chair-test score: `latest_reps / 15 * 100`
- exercise score: `current_streak_days / 7 * 100`
- medication score: `last7d_taken / last7d_scheduled * 100`

The 15-rep and 7-day benchmarks are demo tuning constants, not clinical thresholds — adjust freely, just keep mobile and backend using the same numbers.

**Engagement streak** (`GET /elders/:id/progress` → `engagement_streak_days`): consecutive calendar days with at least one of {`exercise_logs` row, `medication_logs` row, `chair_test_results` row}. Broader than the exercise-only streak already in `exercise.current_streak_days` — this is the single "🔥 N day streak" number the Progress screen leads with.

**Progress graphs** (`GET /elders/:id/progress`, chart-ready, oldest→newest):
- `chair_tests`: already existed — reps over time, capped last 20
- `exercise_history`: last 30 days, `[{date, completed}]`
- `medication_adherence_trend`: last 30 days, `[{date, taken, scheduled}]`

**Performance report** (`GET /elders/:id/report?period=week|month`, family JWT + ownership): a family-facing summary, not an elder-facing one — different audience, different tone. Always lead positive; "areas needing support" is framed as encouragement, never a guilt trip (per the feedback: this should not feel like a burden to check).
```json
{
  "period": "week",
  "range": {"from": "2026-07-09", "to": "2026-07-16"},
  "headline": "Eyang Uti had a great week!",
  "consistency_pct": 86,
  "exercise": {"completed_days": 6, "total_days": 7},
  "medication_adherence_pct": 90,
  "chair_test_trend": "improving",
  "highlights": ["Exercised 6 of 7 days", "Chair test reps up from 9 to 12"],
  "areas_needing_support": ["Missed one evening medication dose on Tuesday"]
}
```

## Config & secrets
- All secrets via env vars; never committed. Ship `.env.example` only (names, no values).
- Shared names: `DATABASE_URL`, `BOT_SERVICE_KEY`, `BACKEND_API_URL`.
- Repo-specific vars (WhatsApp tokens, OpenAI key, push credentials) documented per repo's own `.env.example`.

## Build status
🟡 Design doc, not yet implemented — this is Day 1 of Garuda Hacks 7.0 (2026-07-16). Schema and endpoints above are the target shape for the hackathon build, not a published package. If the schema drifts during implementation, update this file in all four repos before continuing — don't let the interfaces fork.
