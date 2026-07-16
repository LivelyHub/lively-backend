# AGENTS.md — lively-backend

Working agreement for any AI agent (and any human) building this repo. Read this before writing code. It is binding: a PR that ignores it gets sent back.

## What this repo is

The Fastify + Neon Postgres backend for Lively (Garuda Hacks 7.0, Health track). It owns the schema and API contract that `lively-mobile` and `lively-bot` depend on. Contract source of truth: [CORE.md](CORE.md). Scope, schedule, risks: [SPEC.md](SPEC.md), [PLAN.md](PLAN.md).

## The one rule: work the backlog

[docs/BACKLOG.md](docs/BACKLOG.md) is the plan of record. Everything you build traces to a story there.

1. **Read first, every session:** [docs/BACKLOG.md](docs/BACKLOG.md), [docs/SUCCESS-CRITERIA.md](docs/SUCCESS-CRITERIA.md), [docs/TESTING.md](docs/TESTING.md), and [CORE.md](CORE.md). Don't invent work that isn't a story; if you find necessary work that has no story, add a story (with acceptance criteria + test steps) before doing it.
2. **Priority order, no skipping ahead:** finish the P0 spine (B0→B5) before starting P1, and P1 before P2. Within an epic, stories are ordered by dependency — respect it.
3. **Tick the checklist as you go.** When a story's acceptance box is genuinely satisfied and its TESTING.md steps pass, change `- [ ]` to `- [x]` in [docs/BACKLOG.md](docs/BACKLOG.md) **in the same PR** that made it true. The backlog is the shared, live progress record both other teams read — never tick a box you haven't verified, and never leave a finished box unticked.
4. **A story is done only when** all its boxes are `[x]`, its tests are green, and the code is merged. Half-done stories stay `[ ]`.

## Schema is frozen after Day 1

CORE.md's schema and endpoint list freeze at end of Day 1 (2026-07-16). Before then, apply the **Proposed CORE.md amendments** in [docs/BACKLOG.md](docs/BACKLOG.md) to CORE.md in **all four** repo copies — this repo is the source of truth, so a change here that isn't mirrored is a bug. After the freeze, a schema change is a last resort that requires updating all four copies first and telling the mobile + bot teams. Do not work around a missing field locally.

## PRs and commits

- **Branch per story** (or per epic if small): `b3-elders`, `b7-alerts`. Never commit straight to `main`.
- **One logical story per PR.** Keep diffs reviewable.
- **PR description** states: which story (ID), which acceptance boxes it ticks, and how it was tested (the TESTING.md steps you ran). Link the story.
- **Conventional commits**, imperative mood, present tense: `feat(elders): add POST /elders with E.164 validation`, `test(auth): cover full credential matrix`.
- **Do not** run destructive git operations, skip hooks (`--no-verify`), or bypass signing unless explicitly asked.

### Commit / PR text is human-authored — no AI fingerprints

This is a public hackathon repo. Commit messages and PR descriptions must read as written by an engineer:

- **No co-author trailers or attribution.** No `Co-Authored-By: Claude`, no `Co-Authored-By` any AI, no "Generated with Claude Code", no "🤖" footer, no tool self-references anywhere in commits or PRs.
- **No AI-jargon / filler:** avoid "delve", "leverage", "seamless", "robust", "elevate", "in today's fast-paced", "it's worth noting", "as an AI", and similar. Say what changed plainly.
- **No em-dashes.** Use commas, parentheses, or two sentences.
- **No emojis** in commit messages or PR descriptions. (Emoji in product copy / Indonesian companion strings inside the code and docs is fine — that's UX content, not commit metadata.)
- No inflated claims ("massively improves performance"). State the change and its verification.

## Code + environment conventions

- TypeScript, Fastify, Drizzle ORM (per B0.3). Match existing file style; don't reformat code you aren't changing.
- Comments only where they state a non-obvious constraint. No comments narrating what obvious code does.
- Validate every route (zod/TypeBox) — no unvalidated input reaches a query (B9.1).
- **Secrets:** env vars only. `.env.example` documents names, never values. Never commit a real `DATABASE_URL`, `BOT_SERVICE_KEY`, or `JWT_SECRET`. Grep before every push.
- **Windows dev machines:** prefer PowerShell; use forward slashes in paths; no `make` (use package.json scripts); never retry a failed command unchanged more than once — diagnose instead.
- Verify DB reachability before building anything (B0.2) — the venue-network risk is real.

## Definition of done checklist (per PR)

- [ ] Implements exactly one backlog story (or a coherent slice named in the PR)
- [ ] Acceptance boxes for that story ticked in docs/BACKLOG.md, in this PR
- [ ] TESTING.md steps for the story run and passing; `npm test` green
- [ ] No secrets, no AI attribution, no em-dashes/emojis/AI-jargon in commits or PR text
- [ ] CORE.md still matches the shipped schema (amendments mirrored to all four copies if touched)
