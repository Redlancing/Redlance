# Foundation (local backend): conclusion

**Status (2026-10-21):** built and merged to `main` (PR #1, 2026-09-28). Later features added to it: the worker, request-body limits, more error codes, the per-IP pre-limit, the request-path header (so a signed-out visit to any app page comes back to that page after login), and the proxy matcher for every app page. This file was re-checked against the code on `feat/insights` (which holds `feat/alerts` and `feat/ui`) on 2026-10-21; the 12 foundation test files pass (139 cases). Nothing is deployed. Cloud deployment is a separate, later feature (`docs/deployment/`).

## In one paragraph

The foundation is the plumbing every feature sits on. It covers:
- two Docker containers (Postgres and Valkey/Redis) on your laptop;
- one way to read settings, connect to the database and Redis, log, and return errors;
- one wrapper, `apiRoute()`, that every API route goes through, so the IP limit, sign-in check, origin check, input validation and per-user rate limit can't be forgotten;
- a stand-in "dev" login (any email signs you in), so the app can be built before Cognito exists;
- the `/login` page, a gatekeeper (`proxy.ts`) and the signed-in app shell (`(app)/layout.tsx`) that every app page sits in, with `/dashboard` as the first page.

## Architecture

```
Browser
  │
  │  page request (/dashboard)                 API call (/api/v1/...)
  ▼                                            ▼
proxy.ts  ── cookie missing? → 302 /login      apiRoute() wrapper (every route)
  │  (cookie exists: no DB check,                0 per-IP limit ── Redis
  │   adds x-redlance-path header)               1 request ID + logger
  ▼                                              2 session ── Postgres (users)
(app)/layout.tsx                                 3 origin check (POST/PUT/PATCH/DELETE)
  getCurrentUser() ── Postgres (users)           4 params (zod) → 404
  no user → redirect /login?next=<path>          5 input (zod, 256 KB cap) → 400 / 413
  ▼                                              6 per-user rate limit ── Redis
page (dashboard/page.tsx)                        7 handler
  server-side reads from Postgres                8 error JSON + x-request-id + 1 log line
```

- **One Next.js server** does both: server-rendered pages and the `/api/v1` JSON API. Pages read the database directly on the server (they don't call our own API); client components call the API with `fetch`.
- **The session check exists in one place**, `getSessionFromToken()` in `server/session.ts`. API routes reach it through `getSession(request)`, pages through `getCurrentUser()` (which reads the cookie with `next/headers`). Swapping dev login for Cognito means replacing that one function and the login form's backend.
- **Two layers guard app pages:** the proxy is fast and only checks that the cookie **exists**; the layout does the real check (signature + active user in Postgres). Each app page also calls `getCurrentUser()` itself (Next renders layouts and pages in parallel, so a page can't rely on the layout having redirected first). `getCurrentUser()` is wrapped in React's `cache()` (2026-10-21), so the layouts and the page of one render share a single `users` query; before that, `/dashboard` ran it twice and `/feed/<id>` three times.
- **Postgres** holds the data (`users` here). **Redis** holds only rebuildable counters (rate limits, quotas). Health checks don't touch either unless `?deep=1`.
- **The worker** (`apps/worker`) is a separate Node process that shares `packages/db`; it isn't part of the login path.

## The login → dashboard flow, step by step

1. **Signed-out visitor opens `/dashboard`** (or any app page: `/feed`, `/tracker`, `/settings`, `/profile`, `/insights`, `/onboarding`). `proxy.ts` sees no `rl_dev_session` cookie and redirects to `/login?next=/dashboard`. No database or Redis call.
2. **`/login` renders** (`app/(auth)/login/page.tsx`, a server component). It runs `next` through `safeNextPath()` (same-site paths only, default `/dashboard`). If the visitor already has a valid session it redirects straight to `next`. In dev mode the Google button is disabled and a note says any email signs you in.
3. **The visitor types an email and clicks "Continue with email".** `login-form.tsx` sends `POST /api/v1/dev/session` with `{"email": "…"}`. The browser adds `Origin`.
4. **`apiRoute()` runs** (details in "One request, end to end"): IP pre-limit → no session yet (allowed, `auth: false`) → origin must equal `APP_ORIGIN` → email checked with zod → IP-keyed `api` bucket → handler.
5. **The handler `signInDevUser()`** normalises the email (`normalizeEmail` from `@redlance/core`: trim + lowercase) and **upserts** into `users` on `auth_sub = dev|<normalised email>`: a new email creates a user, a known one only updates `last_login_at`. A `blocked` user gets 403 `FORBIDDEN`.
6. **The response** is 200 `{ user: { id, email } }` with `Set-Cookie: rl_dev_session=<userId>.<HMAC-SHA256 signature>; HttpOnly; SameSite=Lax; Path=/; Max-Age=30 days` (`Secure` when `APP_ORIGIN` is https).
7. **The form** calls `router.replace(next)` then `router.refresh()`. Errors are shown inline: 400 → "Enter a valid email address", 403/429 → the server's message, network failure → "Can't reach Redlance".
8. **`/dashboard` again:** the proxy sees the cookie and passes, adding the header `x-redlance-path: /dashboard`. `(app)/layout.tsx` calls `getCurrentUser()`: decode the cookie, check the signature in constant time (`timingSafeEqual`), check the id is a UUID, then `select … from users where id = … and status = 'active'`. No user (bad signature, deleted or blocked) → redirect to `/login?next=<the path from the header>`.
9. **The layout renders the shell:** desktop sidebar (Overview, Matches, Tracker, Insights, Profile, Settings, the email and Sign out), on phones a top bar (logo, Settings, Sign out) and a 5-item tab bar.
10. **The dashboard page** (`dashboard/page.tsx`) checks the user again, then reads the onboarding state.
    - **Not onboarded** (every new user): "Welcome to Redlance", "Signed in as …" and the **"Set up your profile"** card ("Start setup", or "Continue setup · step N of M" when some steps are saved) linking to `/onboarding`. Nothing else is queried. Login never redirects to onboarding by itself; the card is the way in.
    - **Onboarded:** trial days left, the numbers strip (new today, sent this week, won), the setup checklist until it's complete, the top 5 matches and the credits line. These come from later features (`dashboardStats`, `feedPage`, `creditsSummary`); see their conclusions.
11. **Sign out** (`sign-out-button.tsx`): `DELETE /api/v1/dev/session` returns 204 with a cookie that expires immediately; the button then goes to `/login` even if the call failed.

## Endpoints in this phase

Three route files, four handlers. Every one goes through `apiRoute()` (the plain `/health` liveness answer skips it on purpose, see below).

| Method + path | Auth | Rate limit | What it does |
|---|---|---|---|
| `POST /api/v1/dev/session` | none | IP pre-limit + `api` bucket by IP | Signs in (creates the user on first use), sets the cookie. **404 unless `AUTH_MODE=dev`** |
| `DELETE /api/v1/dev/session` | none | IP pre-limit only | Signs out (clears the cookie). 404 unless dev mode |
| `GET /api/v1/me` | required (401 otherwise) | IP pre-limit + `api` bucket by user | Returns `{ user: { id, email } }`. No page uses it today (pages read the session on the server); it's for clients and tests |
| `GET /api/v1/health` | none | none | Liveness: `{ "status": "ok" }`, touches nothing (servers probe it every few seconds; Upstash bills per command) |
| `GET /api/v1/health?deep=1` | none | `health` bucket by IP (10 burst, 1 per 5 s) | Checks Postgres (`select 1`) and Redis (`PING`): 200 `ok`, or 503 `degraded` with which one is down. For deploys and occasional monitoring |

Pages in this phase: `/login`, the `(app)` layout, `/dashboard`. The app has 27 API route files in total; the others belong to later phases (onboarding 7, profile 2, feed 3, drafts 4, replies 2, alerts 3, credits 1, insights 2).

## Decisions (and why)

| Decision | Why |
|---|---|
| Dev login now, Cognito later, behind one function | The app can be built and tested without an AWS account; only `getSessionFromToken()` and the login backend change |
| Dev login is fenced in three ways | `env.ts` refuses to start with `AUTH_MODE=dev` unless `APP_ENV=local`, `APP_ORIGIN` is localhost and `DEV_SESSION_SECRET` has 32+ characters; the route returns 404 outside dev mode |
| Cookie holds only `userId.signature`, and every request re-checks the user in Postgres | A signed cookie can't be forged; the database check means a blocked or deleted user is out on the next request (no waiting for a token to expire) |
| httpOnly, SameSite=Lax cookie (no tokens in JavaScript) | Scripts on the page can't read it (XSS can't steal it); Lax stops most cross-site sends |
| Origin check on every POST/PUT/PATCH/DELETE | Blocks CSRF: another site can't make your browser call our API |
| The proxy only checks the cookie exists | Fast (no database on every navigation); the layout and page do the real check |
| `safeNextPath()` on every `next` | Stops open redirects (`?next=//evil.com`, `/\evil.com`, `/.//evil.com`) |
| Per-IP pre-limit before the session lookup | A flood of junk or forged cookies costs one Redis command, not a database read |
| Rate limits fail open, quotas fail closed | A Redis outage shouldn't take the site down, but it must not allow unlimited paid model calls |
| One Lua script per check, Redis's own clock | Atomic (two requests can't both take the last token), one billed command, all servers agree on time |
| Session check stays in Postgres, not Redis (2026-10-21) | Postgres runs in a container on the same server (sub-millisecond, free); Upstash is a billed network call, and Redis only holds rebuildable data. Revisit when Postgres moves off the app server, gets busy, or there are several servers or regions |
| `/health` touches nothing unless `?deep=1` | Frequent probes would cost Upstash commands and fail for the wrong reasons |
| Settings validated at startup (`instrumentation.ts`) | A bad setting crashes the server immediately, listing every problem, instead of failing on some later request |
| Client IP = `CloudFront-Viewer-Address`, else the **last** `X-Forwarded-For` entry | Earlier entries can be faked by the client; only safe once the server accepts traffic from CloudFront alone |
| One error shape everywhere | The UI handles every failure the same way, and every error carries a `requestId` to find its log line |

## The pieces and where they live

| Piece | File | What it does |
|---|---|---|
| Containers | `docker-compose.yml` | `db` = `pgvector/pgvector:pg17` on `127.0.0.1:5432` (data kept in volume `db-data`). `cache` = `valkey/valkey:8` on `127.0.0.1:6379`, nothing saved to disk. `docker/postgres/init/01-test-db.sql` creates `redlance_test` and `redlance_test_worker` the first time |
| Scripts | root `package.json` | `npm run dev` = start containers and wait until healthy, then run Next.js and the worker side by side (`concurrently`). `db:up`, `db:migrate`, `db:generate`, `db:reset` (deletes data), `test`, `lint`, `typecheck` |
| DB package | `packages/db/src/client.ts`, `migrate.ts`, `migrate-cli.ts`, `errors.ts` | `createDb()` makes a `pg` pool (always with an `error` handler so an idle-connection error can't crash Node) wrapped in Drizzle. `prepareDatabase()` runs migrations, then syncs reference data. `pgErrorCode()` digs the Postgres error code (e.g. `23505` = duplicate) out of wrapped errors |
| First table | `packages/db/src/schema.ts` (`users`), migrations `0000_enable_vector`, `0001_init` | `users`: `id` (uuid), `auth_sub` (unique; `dev|<email>` now, the Cognito `sub` later), `email`, `email_normalized` (unique), `status` (`active`/`blocked`), `created_at`, `last_login_at`. Later tables point at `users.id` |
| Settings | `apps/web/src/server/env.ts` | zod checks every env var at startup (`instrumentation.ts` calls it, then opens the Redis connection). Base settings: `APP_ENV`, `APP_ORIGIN`, `DATABASE_URL`, `REDIS_URL`, `AUTH_MODE`, `DEV_SESSION_SECRET`, `LOG_LEVEL`. Later features added `TELEGRAM_BOT_USERNAME` and the two draft budget limits |
| Errors | `server/errors.ts` | One shape for every error: `{ "error": { code, message, requestId, details? } }`. 26 codes mapped to HTTP statuses (foundation ones: `UNAUTHENTICATED` 401, `BAD_ORIGIN` 403, `FORBIDDEN` 403, `NOT_FOUND` 404, `INVALID_INPUT` 400, `PAYLOAD_TOO_LARGE` 413, `RATE_LIMITED` 429, `UNAVAILABLE` 503, `INTERNAL` 500; the rest belong to later features) |
| Logs | `server/logger.ts` | pino, JSON to stdout (`service: "web"`), one line per request with its request ID |
| Client IP, cookies, body | `server/http.ts` | `clientIp()` (see Decisions; `X-Real-IP` as a last resort, anything that isn't an IP → `"unknown"`). `readCookie()`. `readBody()` refuses bodies over the limit by `Content-Length` first, then by counting the stream |
| DB / Redis clients | `server/db.ts`, `server/redis.ts` | One of each per process, kept on `globalThis` so hot reloads don't leak connections (Postgres pool max 10). Redis: RESP2, 1 s command timeout, 2 s connect timeout, no offline queue (fail fast instead of piling up), backoff 50 ms doubling to 5 s plus jitter, stops retrying on a wrong password, logs one warning per outage. Lint forbids `new Redis()` anywhere else |
| Rate limits | `server/rate-limit/` | See below |
| Sessions | `server/session.ts`, `session-cookie.ts`, `current-user.ts` | Cookie `rl_dev_session` = `<userId>.<HMAC-SHA256 signature>`, httpOnly, SameSite=Lax, 30 days. `getSession(request)` (API routes) and `getCurrentUser()` (pages) both call `getSessionFromToken()`. **That one function is what Cognito replaces** |
| API wrapper | `server/api-route.ts` | See "One request, end to end" |
| Routes | `app/api/v1/health`, `me`, `dev/session` | See "Endpoints in this phase" |
| Gatekeeper | `src/proxy.ts` (Next 16's name for middleware) | Matches `/dashboard`, `/onboarding`, `/feed`, `/tracker`, `/settings`, `/profile`, `/insights` (and sub-paths). No cookie → redirect to `/login?next=<path + query>`. Cookie present → pass, setting `x-redlance-path` to the requested path (overwriting any value the client sent) |
| Request path | `server/request-path.ts` | `REQUEST_PATH_HEADER` and a helper that reads its query string; layouts aren't given the URL, so this is how `(app)/layout.tsx` builds its `/login?next=` redirect |
| Safe redirects | `lib/safe-next.ts` | `safeNextPath()` checks the normalised URL, so dot segments and backslashes can't sneak an off-site redirect past it |
| Pages | `app/(auth)/layout.tsx`, `(auth)/login/page.tsx`, `login-form.tsx`, `app/(app)/layout.tsx`, `(app)/dashboard/page.tsx` | See the flow above |
| Shell | `components/app/app-sidebar.tsx`, `app-nav.ts`, `mobile-tab-bar.tsx`, `sign-out-button.tsx`, `onboarding-cta.tsx` | Sidebar and tab bar share one list (`appNav`); nav links never prefetch (every app page is dynamic, so prefetching would run each page's queries just because a link is on screen) |

## Rate limits (how they work)

Each check is **one Redis command**: a small Lua script runs inside Redis, so reading and updating the counter happen atomically. Two parallel requests can't both take the last token.

- **Token bucket** (`consume`). A bucket holds up to `capacity` tokens and refills at a steady rate; each request takes one. Key: `rl:{u:<userId>}:<bucket>`, or `rl:{ip:<ip>}:<bucket>` when signed out. The clock is Redis's own `TIME`, so several servers agree.
  - `api` (the default for every route): 30 burst, refills 2 a second.
  - `ip`: 120 burst, refills 4 a second. The per-IP **pre-limit**, checked first for every `/api/v1` route except `/api/v1/health`, before the session lookup. Skipped when no IP can be determined (local requests without proxy headers, tests), so it never becomes one shared bucket for everyone.
  - `health`: 10 burst, one every 5 s.
  - Later features added `alerts-settings` and `alerts-link`.
  - **Fails open:** if Redis is down, the request is allowed. Better to lose rate limiting for a minute than take the site down.
  - Over the limit: 429 `RATE_LIMITED` with `Retry-After` in seconds.
- **Daily quota** (`consumeQuota`). A counter per user per day (UTC), key `q:{u:<id>}:<name>:<yyyymmdd>`. Used by onboarding imports (5 resumes a day, 5 GitHub imports a day).
  - **Fails closed (503):** quotas protect paid things (model calls), so if we can't count, we don't spend.
- **Window counter** (`countInWindow`, added by drafts): a soft "slow down" warning only; fails open.

## One request, end to end

Signing in, then calling `GET /api/v1/me`:

1. The login form sends `POST /api/v1/dev/session {"email": "…"}`. The browser adds the `Origin` header.
2. `apiRoute()` runs its steps in order, stopping at the first failure:
   0. **IP pre-limit** (see above).
   1. Pick a request ID (`x-request-id`, else `x-amzn-trace-id`, else a new UUID) and make a logger for it.
   2. **Session:** read the cookie. There is none, which is allowed because this route has `auth: false`. (On a route without `auth: false`, no session → 401.)
   3. **Origin:** for POST/PUT/PATCH/DELETE, `Origin` must equal `APP_ORIGIN`, or 403 `BAD_ORIGIN`.
   4. **Params:** route params are checked against a zod schema; a mismatch gives 404.
   5. **Input:** for GET/HEAD/DELETE the query string, otherwise the body (256 KB cap, 413 if over) parsed as JSON; checked with zod (400 with per-field `details`).
   6. **Rate limit:** `rl:{ip:…}:api` here (no user yet), one Redis call.
   7. **Handler:** upsert the user on `auth_sub`, return 200 with `Set-Cookie: rl_dev_session=…`.
   8. On the way out: any `ApiError` becomes the standard error JSON, and anything unexpected becomes a logged 500 with a plain message. The `x-request-id` header is set, and one log line is written: `{requestId, userId, method, path, status, durationMs}`.
3. The browser goes to `next` (e.g. `/dashboard`); see steps 8–10 of the flow.
4. `GET /api/v1/me` goes through the same wrapper. This time the session is found, the origin check is skipped (GET), and the bucket is `rl:{u:<id>}:api`. The response is `{ user: { id, email } }`.

## How it connects to the rest

- **Onboarding** adds its routes through `apiRoute()`, uses `consumeQuota` for imports, and adds tables in `packages/db`. `prepareDatabase()` also copies the skill taxonomy and subreddit catalogue into the database (`syncReferenceData`). Its pages check the session through `loadOnboardingPage()`. The dashboard's "Set up your profile" card is the way in.
- **The app pages** (feed, tracker, settings, profile, insights) sit inside `(app)/layout.tsx` and are listed in the proxy matcher.
- **The worker** (`apps/worker`) uses `packages/db` the same way but has its own settings file and logger. `npm run dev` starts it next to Next.js.
- **Cognito** will replace only `getSessionFromToken()` and the login form's backend. The cookie name lives in `session-cookie.ts` for that reason.
- **Deployment** relies on `clientIp()` trusting CloudFront's header. That is only safe once the server accepts traffic from CloudFront alone.

## Tests

The tests use the `redlance_test` database and Redis db 15, so they never touch your dev data. `apps/web/test/global-setup.ts` migrates once. `helpers.ts` empties the tables and Redis db 15 before each test. Run on 2026-10-21: 12 files, **139 cases pass**.

| Test file | Blocks |
|---|---|
| `rate-limit.test.ts` | 16 |
| `api-route.test.ts` | 14 |
| `env.test.ts` | 14 |
| `session.test.ts` | 10 |
| `http.test.ts` | 10 |
| `redis.test.ts` | 9 |
| `routes.test.ts` | 9 |
| `api-route-ip-limit.test.ts` | 6 |
| `proxy.test.ts` | 5 |
| `errors.test.ts` | 3 |
| `safe-next.test.ts` | 2 (table-driven, many cases) |
| `request-path.test.ts` | 2 |

Plus `packages/db` client tests. Tests need the containers running (`npm run db:up`).

## Known gaps (none block work)

- The per-user limit runs after the session lookup, origin check and body read; the per-IP pre-limit guards the session lookup.
- `x-request-id` (and `x-amzn-trace-id`) from the client aren't validated, so a client can put any text in our log lines.
- A database outage during the session lookup returns 500, not 503. Error logs can contain email addresses (no pino redaction).
- `AUTH_MODE=cognito` throws in `getSessionFromToken()` for **every** wrapped route until the Cognito login is built.
- `refillPerSec: 0` isn't guarded.
- The sign-in upsert conflicts only on `auth_sub`. Revisit before Cognito (the same email from Google and from an email code would hit the `email_normalized` unique index and fail with a 500).
- Sign-out only clears the cookie; there is no server-side session list, so a copied cookie stays valid for its 30 days unless the user is blocked. Cognito brings revocable tokens.
- The 30-day expiry is enforced only by the browser (`Max-Age`): the cookie value has no date inside it, so a copied value stays valid past 30 days. Left for Cognito (decided 2026-10-21; its JWTs carry `exp`); dev login runs only on localhost.
- There is no test that `/health` stays 200 while Postgres is down.
- Not built yet: Cognito, a Dockerfile, `infra/` (CDK), CI.

Fixed since 2026-10-17: the homepage "Start free" buttons (header, hero, final call to action, pricing, announcement bar) pointed at a missing `/signup` and now go to `/login`, which also creates accounts. `(app)/layout.tsx` no longer hardcodes `next=/dashboard` (it uses the `x-redlance-path` header from the proxy).

## How to run it

```sh
npm install
cp apps/web/.env.example apps/web/.env.local     # set DEV_SESSION_SECRET: openssl rand -base64 32
npm run db:up && npm run db:migrate
npm run dev                                      # http://localhost:3000 (3001 if 3000 is taken; then set APP_ORIGIN to match)
curl localhost:3000/api/v1/health?deep=1         # {"status":"ok","db":"ok","cache":"ok"}
```

### What to check in the browser

1. Signed out, open `/feed` → you land on `/login?next=%2Ffeed`.
2. Sign in with a new email → you land on `/feed`; with no `next`, on `/dashboard` with the "Set up your profile" card.
3. Open `/login` while signed in → straight to the dashboard.
4. Try `/login?next=//evil.com` → after sign-in you land on `/dashboard`, not off-site.
5. Edit the `rl_dev_session` cookie in DevTools (change one character) → the next page load sends you to `/login`.
6. Sign out → `/login`; reloading `/dashboard` sends you back to `/login`.
7. `curl -X POST localhost:3000/api/v1/dev/session -H 'content-type: application/json' -d '{"email":"a@b.co"}'` (no `Origin`) → 403 `BAD_ORIGIN`.
