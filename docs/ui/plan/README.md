# App UI: phase plan

Design: `../README.md`. Branch: `feat/ui` (from `feat/alerts`). Delete this folder once `../conclusion.md` is written.

Workflow (as agreed): each phase is labelled with the model that builds it. Sonnet/Haiku phases go to subagents (in parallel when their files don't overlap); Opus phases stay in the main session. After each phase a Haiku subagent runs typecheck, lint and the affected tests and commits with explicit `git add <paths>` (never `-A`), no Claude trailers. One fresh review of the whole branch at the end.

UI phases end with a browser check (Playwright) against `npm run dev` on port 3001, **only once the soak worker is stopped** (the dev script starts a second worker). Until then, checks are typecheck, lint and unit tests.

## Phase 0: foundation (Sonnet)

Files: `src/lib/api-client.ts`, `src/lib/api-errors.ts`, `src/lib/use-poll.ts` (+ a pure scheduler in `src/lib/poll.ts`), `src/lib/format.ts`, their tests; `src/components/app/app-nav.ts`, `app-sidebar.tsx`, new `app-nav-links.tsx` (client) and `mobile-tab-bar.tsx`; `src/app/(app)/layout.tsx`; `src/proxy.ts`; shadcn components.

1. `apiFetch<T>(url, init?)` → `{ ok: true, status, data: T } | { ok: false, status, code, message, details?, retryAfter? }`. JSON body when `init.json` is given (sets content-type). `cache: "no-store"`. Network error → `status 0, code "NETWORK"`. 401 → `window.location.assign("/login?next=" + current path)` and returns the error. `Retry-After` parsed to seconds.
2. `errorMessage(err)` from a table keyed by code (see design §4), with `{n}` filled from `retryAfter`; falls back to the server message, then "Something went wrong. Please try again."
3. `createPoller({ fn, intervalMs, firstDelayMs?, timeoutMs, isDone })`: pure, clock-injectable scheduler (no overlap, stops on done/timeout, `pause()`/`resume()`); `usePoll` wraps it and pauses on `document.visibilityState === "hidden"`. Tests drive the scheduler with a fake clock.
4. `format.ts`: `timeAgo(iso, now)` ("now", "5m", "2h", "3d", then "Oct 12"), `budgetText(budget)` (reuse `budgetLabel` from `@redlance/core` if it fits the web shape), `scoreBand(score)` → `"strong" | "good" | "fair"` (≥ 85, ≥ 70, else), `communityUrl(name)`.
5. Nav: hrefs `/dashboard`, `/feed`, `/tracker`, `/settings`; Profile stays `soon` (href `/profile`). Active by pathname prefix (`/feed/x` → Matches) in a small client component used by the server sidebar. Remove the `activeHref` prop.
6. Mobile tab bar: fixed bottom, 4 items with icon + label, `aria-current`, safe-area padding; the layout's `main` gets bottom padding on mobile.
7. `proxy.ts` matcher adds `/feed/:path*`, `/tracker/:path*`, `/settings/:path*`; the layout's redirect keeps the requested path (use the `next` the proxy set; fall back to `/dashboard`).
8. shadcn (via `npx shadcn@latest add … -c apps/web`): `dialog`, `dropdown-menu`, `switch`, `skeleton`, `sonner`, `tooltip`. Add `<Toaster />` to the app layout. Restyle to the tokens in design §2 where the defaults differ (radius 6 px, no shadows on menus beyond one soft one).

Done when: unit tests for 1–4 pass; typecheck and lint clean.

## Phase 1: backend additions for the UI (Opus)

Files: `packages/db/src/matches.ts` (+ test), `apps/web/src/server/feed.ts`, new `apps/web/src/app/api/v1/feed/[matchId]/route.ts`, feed tests; `packages/db/src/dashboard.ts` (+ test).

1. `feedItem(db, userId, matchId)` → `FeedItem & { post: { body }, withdrawn: boolean }` or null. Unlike the feed page it **includes dismissed and withdrawn** matches (a Telegram deep link must still open). Share the select/mapping with `feedPage` (extract the SQL fragment and row mapper; don't copy them).
2. `GET /api/v1/feed/:matchId` → that item (dates as ISO), 404 when not the user's. Default rate bucket.
3. `dashboardStats(db, userId, { now, timeZone })` → `{ newToday, sentThisWeek, won }` (matches created since local midnight and not dismissed/withdrawn; replies `sent_at` in the last 7 days; replies with status `hired`). One query.
4. Tests: ownership 404, dismissed/withdrawn still returned with the flag, body present, stats counts and the time-zone edge.

## Phase 2: matches list (Opus)

Files: `src/app/(app)/feed/layout.tsx`, `page.tsx`, `src/components/feed/*` (list, row, filters, new-gigs bar, empty/skeleton), `src/components/feed/feed-state.ts` (+ test).

1. `feed/layout.tsx`: the split view. Desktop: list column + `children` (the detail). Mobile: the list on `/feed`, only the detail on `/feed/[id]` (decided by the segment, via `useSelectedLayoutSegment`).
2. List state as a reducer in `feed-state.ts` (pure, tested): load page, append page, set status (optimistic, with rollback), remove on dismiss + undo, prepend new items without duplicates, select.
3. Row, filters (Best/All, job types limited to the profile's categories, Paid only) kept in the URL search params so a reload or the back button keeps them.
4. Opening a row: navigate to `/feed/<id>`, and `POST status seen` if it was `new` (fire and forget; the reducer updates at once).
5. Save / Dismiss with an Undo toast; keyboard shortcuts `j k Enter s d o` while the list has focus (not inside inputs).
6. Refresh on window focus and a refresh button. (2b, after the cache decision: the `since` poll + "N new gigs" bar.)
7. Not-onboarded state (server check in the layout via `getOnboardingState`).
8. Browser check when possible.

## Phase 3: match detail and draft composer (Opus)

Files: `src/app/(app)/feed/page.tsx` (desktop "Pick a gig" empty pane), `src/app/(app)/feed/[matchId]/page.tsx`, `src/components/feed/detail/*`, `src/components/drafts/*`, `src/components/drafts/composer-state.ts` (+ test).

1. Server page loads the match through `feedItem` (404 → `notFound()`), renders the post block, red flags, how-to-apply, why-it-matched, action bar.
2. Composer (client): on mount `GET /drafts?matchId` (existing versions; show the newest done one). Draft reply → `POST /drafts` with a fresh idempotency key → poll `GET /drafts/:id` (1.5 s first, then every 1 s, give up at 30 s with "Taking longer than usual — check back in a minute", keep polling slowly at 5 s up to the server's 10-minute expiry while the tab stays open).
3. Editable Comment and DM tabs (local edits per version; leaving with unsent edits asks first), Copy, Open post, **I sent it** → choose comment or DM → `POST /replies` with the edited text → "Tracked. We'll ask how it went." and the match shows `Replied`.
4. Rewrite menu (costs shown), custom instruction (1–200 chars), version switcher, the 5-version limit, thumbs-down feedback.
5. Error handling per code (402, 429 DAILY_LIMIT, 403 PLAN_EXPIRED/FORBIDDEN, 503, 409s) with a next step; `slowDown` shows a gentle note.
6. Cost line from `GET /credits` ("7 credits · about N replies left").
7. Browser check when possible.

## Phase 4: tracker (Sonnet)

Files: `src/app/(app)/tracker/page.tsx`, `src/components/tracker/*` (+ a pure state/format test).

`GET /replies` with status tabs and the cursor; status menu → `PATCH /replies/:id`; Hired form (rate in major units converted to minor units, currency from the profile's currency by default, "unpaid" checkbox) — rate and currency sent together or not at all; row links to `/feed/<matchId>`. Empty, loading, error states per design §6.

## Phase 5: settings (Sonnet)

Files: `src/app/(app)/settings/page.tsx`, `src/components/settings/*` (+ a pure test of the Telegram state machine: idle → linking → waiting → connected / expired / error).

Telegram card (design §5.4, including the three disabled reasons and 503), alert rules (min score 50–100, daily cap 1–100, debounced PATCH, 403 → onboarding CTA), account card (`/me`, `/credits`, plan and trial end). Disconnect asks for confirmation.

## Phase 6: overview (Sonnet)

Files: `src/app/(app)/dashboard/page.tsx`, `src/components/dashboard/*`.

Real stats from `dashboardStats`, the setup checklist (onboarding done, Telegram connected, first reply sent), the five newest strong matches linking to `/feed/<id>`, credits line. Keeps the existing not-onboarded CTA.

Phases 4, 5 and 6 don't share files and can run in parallel after phase 0 (6 needs phase 1).

## Phase 7: review, browser pass, docs (Opus)

- Fresh review of the whole branch (correctness, a11y basics, error states, anti-slop score per the design's quality gate).
- Browser pass over every page at desktop and phone width (once the soak worker is stopped and a dev user is onboarded).
- `docs/ui/conclusion.md`, `docs/README.md` status row, CLAUDE.md "Where we are".

## Waiting on the user

- Feed polling: Redis cache-aside / cache-aside + push / Postgres `since` query (phase 2b).
- Onboarding review-step copy (Telegram instead of email).
- Stopping the soak (ends ~11:55 on 2026-10-21) before browser checks; an onboarded dev user for real data.
