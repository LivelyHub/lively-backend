# lively-backend

REST API and data layer for **Lively** — the shared brain between the family mobile app and the WhatsApp companion bot.

`lively-backend` owns the Postgres schema and API contract that [`lively-mobile`](../lively-mobile) and [`lively-bot`](../lively-bot) both depend on: elders, family members, companion personas, conversation logs, Chair Stand fall-risk assessments, exercise and medication tracking, safety-escalation alerts, family message relay ("titipan"), and progress/streak reporting.

> [!NOTE]
> Built for **Garuda Hacks 7.0** (Health track). Part of a four-repo system — `lively-landing`, `lively-mobile`, `lively-backend`, `lively-bot` — sharing a common data/API contract documented in [CORE.md](CORE.md).

## Tech stack

- Node.js + TypeScript (ESM), [Fastify](https://fastify.dev) as the web framework
- [Drizzle ORM](https://orm.drizzle.team) over PostgreSQL (Neon in production, local Postgres via Docker in dev)
- `zod` for request validation, `@fastify/jwt` for mobile-client auth, `bcryptjs` for password hashing
- `@fastify/rate-limit`, `@fastify/cors`, `@fastify/multipart` + `@fastify/static` for uploads

## Getting started

### Prerequisites

- Node.js 20+
- Docker (for local Postgres) or a Neon/Postgres connection string

### Install and run

```bash
npm install
cp .env.example .env     # fill in the values below
docker compose up -d      # local Postgres on port 5433
npm run db:migrate
npm run seed               # optional: seed sample data
npm run dev                # tsx watch on src/server.ts
```

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run seed` | Seed the database |

### Configuration

Set these in `.env` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Signs mobile-client auth tokens |
| `BOT_SERVICE_KEY` | Shared secret authenticating `lively-bot` calls |
| `PORT` | HTTP port (defaults to `7000`) |
| `BACKEND_API_URL` | This service's own public base URL |
| `BOT_REPLY_URL` | URL of `lively-bot`'s `/reply` endpoint |
| `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Cloud API credentials |
| `META_APP_SECRET` | Verifies WhatsApp webhook signatures |

> [!WARNING]
> Never commit real values — `.env` is gitignored. Only `.env.example` (names, no secrets) belongs in source control.

### Docker

```bash
docker build -t lively-backend .
docker run -p 7000:7000 --env-file .env lively-backend
```

`docker-compose.yml` also spins up a local `postgres:16-alpine` instance for development, with a healthcheck, on host port `5433`.

## API structure

Routes are modular under `src/modules/`, each with its own `routes.ts` and `service.ts`:

```
src/modules/
├── auth              # login, JWT issuance
├── elders            # elder profiles, soul/persona setup
├── family-members
├── conversations       # chat log, used by lively-mobile's read-only monitor
├── assessments          # Chair Stand fall-risk scoring
├── medications
├── alerts               # safety escalation (pain, no-response, emergency)
├── titipan               # family message relay
├── progress              # streaks, gamification (computed at read time)
├── report                # weekly / monthly performance summaries
├── uploads
└── webhook               # WhatsApp Cloud API verification + inbound messages

src/shared/    # auth guards, HTTP errors, scheduler, bot-sync, upload helpers
src/db/        # Drizzle schema, connection, seed script
```

Authentication differs by caller: mobile clients use JWT bearer tokens; `lively-bot` authenticates with a static `BOT_SERVICE_KEY` header.

