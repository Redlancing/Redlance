# Phase 6: Web API and onboarding copy

Model: **Sonnet** (follows the existing routes) · Runs after Phase 3 (can run alongside 4–5)

## Why

Users need to see and change their alert settings and connect or disconnect Telegram. The settings UI comes with the dashboard; this phase builds the API it will call, and fixes the one sentence in onboarding that promises email.

## Files

All routes use `apiRoute()` (session → origin → input → rate limit).

### `apps/web/src/server/alerts.ts` (new)

Service functions the routes call: `getAlertSettings(db, userId)`, `updateAlertSettings(db, userId, patch)`, `startTelegramLink(db, userId) → { url, expiresAt }` (32 random bytes → base64url token; store `sha256`; `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}`), `unlinkTelegram(db, userId)`.

### `apps/web/src/app/api/v1/alerts/settings/route.ts` (new)

- `GET` → `{ minScore, dailyCap, telegram: { linked, enabled, disabledReason } }`. The chat id is never returned.
- `PATCH` input `{ minScore?: 0–100, dailyCap?: 1–100 }`. Rate-limit bucket `alerts-settings` (20 a minute).

### `apps/web/src/app/api/v1/alerts/telegram/link/route.ts` (new)

`POST` → `startTelegramLink`. Bucket `alerts-link` (5 a minute). Returns 503 `TELEGRAM_UNAVAILABLE` when `TELEGRAM_BOT_USERNAME` isn't set.

### `apps/web/src/app/api/v1/alerts/telegram/route.ts` (new)

`DELETE` → disable the channel (`user_stop`). Idempotent.

### `apps/web/src/server/env.ts` (extend)

`TELEGRAM_BOT_USERNAME` (optional). Update `apps/web/.env.example`.

### `apps/web/src/server/rate-limit` (extend)

Buckets `alerts-settings`, `alerts-link`.

### `apps/web/src/components/onboarding/review-step.tsx` (edit)

Replace "New matches are emailed to {email}. You can add Telegram later from the dashboard." with a Telegram sentence. Proposed: **"Connect Telegram from your dashboard to get new matches the moment they're posted."** Confirm the wording with the user before changing it; update the component test.

## Tests (write first, `apps/web/src/app/api/v1/alerts/alerts.test.ts`)

- settings: GET defaults after onboarding; PATCH validation errors; another user's data never visible;
- link: returns a `t.me` URL, stores only the hash, 15 min expiry, 503 without a bot username, rate limit;
- unlink: idempotent;
- `routes.test.ts`: the new routes are registered and use `apiRoute`.

## Done when

Web tests green; `curl` against the dev server links a real Telegram account (with Phase 5's bot running).
