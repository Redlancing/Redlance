# Redlance
Redlance is an AI tool that finds freelance jobs on Reddit, matches them to your skills, and drafts replies in your voice.

## Development

Needs Docker Desktop and Node 24 (`fnm use` reads `.nvmrc`).

```sh
npm install
cp apps/web/.env.example apps/web/.env.local   # then set DEV_SESSION_SECRET: openssl rand -base64 32
npm run db:up        # Postgres (db) and Valkey (cache) in Docker
npm run db:migrate
npm run dev          # starts db + cache if needed, then Next.js on http://localhost:3000
npm test             # unit + integration tests (needs db and cache running)
```

- Sign in locally: `POST /api/v1/dev/session {"email": "..."}` (only exists when `AUTH_MODE=dev`).
- Change the schema: edit `packages/db/src/schema.ts`, run `npm run db:generate`, commit the new file in `packages/db/migrations/`, run `npm run db:migrate`.
- Start from scratch: `npm run db:reset` (deletes local data).

Layout:

- `apps/web` — Next.js marketing site and web app; server-only code in `src/server/`
- `packages/db` — database schema, client and migrations
- `brand/` — logo files and brand guide
- `apps/worker` — background worker (resume/GitHub imports, Reddit ingestion, post analysis)
- `packages/core`, `packages/llm` — shared pure code (taxonomy, schemas, catalogue) and the Gemini client
- `docs/` — product spec (`PROJECT.md`) and one folder per feature; each built feature has a `conclusion.md` explaining how it works. Start at `docs/README.md`
