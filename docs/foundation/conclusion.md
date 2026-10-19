# Foundation (local backend): conclusion

**Status (2026-10-17):** built and merged to `main` (PR #1, 2026-09-28). Later features have added to it: the worker, request-body limits, extra error codes and the onboarding redirect. Nothing is deployed. Cloud deployment is a separate, later feature (`docs/deployment/`).

## In one paragraph

The foundation is the plumbing every feature sits on. It covers:
- two Docker containers (Postgres and Valkey/Redis) on your laptop;
- one way to read settings, connect to the database and Redis, log, and return errors;
- one wrapper, `apiRoute()`, that every API route goes through, so sign-in checks, origin checks, input validation and rate limits can't be forgotten;
- a stand-in "dev" login, so the app can be built before Cognito exists;
- the `/login` page and a basic `/dashboard`.

## The pieces and where they live

| Piece | File | What it does |
|---|---|---|
| Containers | `docker-compose.yml` | `db` = `pgvector/pgvector:pg17` on `127.0.0.1:5432` (data kept in volume `db-data`). `cache` = `valkey/valkey:8` on `127.0.0.1:6379`, nothing saved to disk. `docker/postgres/init/01-test-db.sql` creates `redlance_test` and `redlance_test_worker` the first time |
| Scripts | root `package.json` | `npm run dev` = start containers and wait until healthy, then run Next.js and the worker side by side (`concurrently`). `db:migrate`, `db:generate`, `db:reset` (deletes data), `test`, `lint`, `typecheck` |
| DB package | `packages/db/src/client.ts`, `migrate.ts`, `migrate-cli.ts`, `errors.ts` | `createDb()` makes a `pg` pool (always with an `error` handler so an idle-connection error can't crash Node) wrapped in Drizzle. `prepareDatabase()` runs migrations, then syncs reference data. `pgErrorCode()` digs the Postgres error code (e.g. `23505` = duplicate) out of wrapped errors |
| First table | `packages/db/src/schema.ts` (`users`), migrations `0000_enable_vector`, `0001_init` | `users`: `id`, `auth_sub` (unique; `dev|<email>` now, the Cognito `sub` later), `email`, `email_normalized` (unique), `status` (`active`/`blocked`), timestamps |
| Settings | `apps/web/src/server/env.ts` | zod checks every env var at startup (`instrumentation.ts` calls it, so a bad setting crashes the server immediately, listing every problem). Rule: `AUTH_MODE=dev` only with `APP_ENV=local`, a localhost `APP_ORIGIN`, and a `DEV_SESSION_SECRET` of 32+ characters |
| Errors | `server/errors.ts` | One shape for every error: `{ "error": { code, message, requestId, details? } }`. Codes map to HTTP statuses (`UNAUTHENTICATED` 401, `BAD_ORIGIN` 403, `INVALID_INPUT` 400, `RATE_LIMITED` 429, `UNAVAILABLE` 503, …) |
| Logs | `server/logger.ts` | pino, JSON to stdout, one line per request with its request ID |
| Client IP | `server/http.ts` | `clientIp()` trusts `CloudFront-Viewer-Address`, else the **last** `X-Forwarded-For` entry (the one our own proxy added; earlier ones can be faked) |
| DB / Redis clients | `server/db.ts`, `server/redis.ts` | One of each per process, kept on `globalThis` so hot reloads don't leak connections. Redis: 1 s command timeout, no offline queue (fail fast instead of piling up), backoff with jitter, stops retrying on a wrong password, logs one warning per outage. Lint forbids `new Redis()` anywhere else |
| Rate limits | `server/rate-limit/` | See below |
| Sessions | `server/session.ts`, `session-cookie.ts`, `current-user.ts` | Dev login: cookie `rl_dev_session` = `<userId>.<HMAC signature>`, httpOnly, 30 days. `getSession(request)` (API routes) and `getCurrentUser()` (pages) both call `getSessionFromToken()`, which checks the signature and then that the user still exists and is `active`. **That one function is what Cognito replaces** |
| API wrapper | `server/api-route.ts` | See "One request, end to end" |
| Routes | `app/api/v1/health`, `me`, `dev/session` | `/health` = "the process is up", never touches Postgres or Redis. `/health?deep=1` checks both (503 if either is down). `/me` = who am I. `/dev/session` POST signs in, DELETE signs out (404 unless dev mode) |
| Pages | `app/(auth)/login/`, `app/(app)/layout.tsx`, `app/(app)/dashboard/page.tsx`, `components/app/` | Login: Google button (disabled in dev) and email. Dashboard: sidebar (Overview, then "Soon" items), setup card, zero stats, empty matches |
| Gatekeeper | `src/proxy.ts` (Next 16's name for middleware) | `/dashboard/*` and `/onboarding/*` without a session cookie → redirect to `/login?next=…`. It only checks the cookie **exists** (fast, no DB). The real check is in `(app)/layout.tsx` |
| Safe redirects | `lib/safe-next.ts` | `safeNextPath()` only allows same-site paths, so `?next=//evil.com` can't send people elsewhere |

## Rate limits (how they work)

Each check is **one Redis command**: a small Lua script runs inside Redis, so reading and updating the counter happen atomically. Two parallel requests can't both take the last token.

- **Token bucket** (`consume`). A bucket holds up to `capacity` tokens and refills at a steady rate; each request takes one. Key: `rl:{u:<userId>}:<bucket>`, or `rl:{ip:<ip>}:<bucket>` when signed out. The clock is Redis's own `TIME`, so several servers agree.
  - `api`: 30 burst, refills 2 a second.
  - `health`: 10 burst, one every 5 s.
  - **Fails open:** if Redis is down, the request is allowed. Better to lose rate limiting for a minute than take the site down.
- **Daily quota** (`consumeQuota`). A counter per user per day (UTC), key `q:{u:<id>}:<name>:<yyyymmdd>`. Used by onboarding imports (5 resumes a day, 10 GitHub imports a day).
  - **Fails closed (503):** quotas protect paid things (model calls), so if we can't count, we don't spend.

## One request, end to end

Signing in, then calling `GET /api/v1/me`:

1. The login form sends `POST /api/v1/dev/session {"email": "…"}`. The browser adds the `Origin` header.
2. `apiRoute()` runs its steps in order:
   1. Pick a request ID (`x-request-id` header or a new UUID) and make a logger for it.
   2. **Session:** read the cookie. There is none, which is allowed because this route has `auth: false`.
   3. **Origin:** for POST/PUT/PATCH/DELETE, `Origin` must equal `APP_ORIGIN`, or 403. This stops other sites from making your browser call our API (CSRF).
   4. **Params:** route params are checked against a zod schema; a mismatch gives 404.
   5. **Input:** the body is read with a 256 KB cap (413 if over), parsed as JSON, and checked with zod (400 with per-field `details`).
   6. **Rate limit:** `rl:{ip:…}:api`, one Redis call.
   7. **Handler:** upsert the user on `auth_sub`, return 200 with `Set-Cookie: rl_dev_session=…`.
   8. On the way out: any `ApiError` becomes the standard error JSON, and anything unexpected becomes a logged 500 with a plain message. The `x-request-id` header is set, and one log line is written: `{requestId, userId, method, path, status, durationMs}`.
3. The browser goes to `next` (e.g. `/dashboard`). `proxy.ts` sees the cookie and lets it through, then `(app)/layout.tsx` calls `getCurrentUser()`, which verifies the signature and looks up an active user. No user means a redirect to `/login`.
4. `GET /api/v1/me` goes through the same wrapper. This time the session is found, the origin check is skipped (GET), and the bucket is `rl:{u:<id>}:api`. The response is `{ user: { id, email } }`.

## How it connects to the rest

- **Onboarding** adds its routes through `apiRoute()`, uses `consumeQuota` for imports, and adds tables in `packages/db`. `prepareDatabase()` also copies the skill taxonomy and subreddit catalogue into the database (`syncReferenceData`).
- **The worker** (`apps/worker`) uses `packages/db` the same way but has its own settings file and logger. `npm run dev` starts it next to Next.js.
- **Cognito** will replace only `getSessionFromToken()` and the login form's backend. The cookie name lives in `session-cookie.ts` for that reason.
- **Deployment** relies on `clientIp()` trusting CloudFront's header. That is only safe once the server accepts traffic from CloudFront alone.

## Tests

The tests use the `redlance_test` database and Redis db 15, so they never touch your dev data. `apps/web/test/global-setup.ts` migrates once. `helpers.ts` empties `users` and Redis db 15 before each test. The foundation has about 86 test blocks, which expand to about 112 cases:

| Test file | Blocks |
|---|---|
| `api-route.test.ts` | 14 |
| `rate-limit.test.ts` | 10 |
| `session.test.ts` | 10 |
| `http.test.ts` | 10 |
| `redis.test.ts` | 9 |
| `routes.test.ts` | 9 |
| `env.test.ts` | 8 |
| `proxy.test.ts` | 3 |
| `safe-next.test.ts` | 16 cases |
| `packages/db` | 7 |

Tests need the containers running (`npm run db:up`).

## Known gaps (from the code review; none block work)

- The rate limit runs **after** the session lookup, origin check and body read. A flood of bad requests still costs a database lookup each. Idea: a per-IP pre-limit first.
- `x-request-id` from the client isn't validated.
- A database outage during the session lookup returns 500, not 503. Error logs can contain email addresses (no pino redaction).
- `AUTH_MODE=cognito` throws in `getSessionFromToken()` for **every** wrapped route until the Cognito login is built.
- `refillPerSec: 0` isn't guarded.
- `(app)/layout.tsx` hardcodes `next=/dashboard` and `activeHref="/dashboard"`.
- The sign-in upsert conflicts only on `auth_sub`. Revisit before Cognito (the same email from Google and from an email code).
- There is no test that `/health` stays 200 while Postgres is down.
- Not built yet: Cognito, a Dockerfile, `infra/` (CDK), CI.

## How to run it

```sh
npm install
cp apps/web/.env.example apps/web/.env.local     # set DEV_SESSION_SECRET: openssl rand -base64 32
npm run db:up && npm run db:migrate
npm run dev                                      # http://localhost:3000 (3001 if 3000 is taken; then set APP_ORIGIN to match)
curl localhost:3000/api/v1/health?deep=1         # {"status":"ok","db":"ok","cache":"ok"}
```
