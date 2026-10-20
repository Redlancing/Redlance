# App UI (signed-in app): design

**Status (2026-10-20):** design and phase plan written; build in progress on `feat/ui` (branched from `feat/alerts`, which holds the alerts API). The phase plan is in `plan/README.md`; delete `plan/` once the conclusion is written.

The backend for the feed, drafts, the reply tracker, alerts and credits is built and tested, but nothing in the web app calls it. Only onboarding and the dev login are wired. This doc designs the pages that connect them.

## 1. What the user is doing

A freelancer opens Redlance a few times a day (or taps a Telegram alert) to do one job: **look at new gigs, drop the bad ones fast, and reply to the good ones in under two minutes.** Everything else (tracker, settings, credits) is secondary.

So the app is a **triage desk**, not a dashboard of cards:

- a dense, scannable list of matches, newest first, with the score, budget and reason readable without opening anything;
- one gig open at a time next to the list, with the post, the red flags and the draft composer;
- the user sends on Reddit themselves (rule 1): we give them the text, a Copy button and "Open post", then ask "Did you send it?".

## 2. Design direction (anti-slop pass)

Classified as an **app screen / work queue** (dashboard checklist). Direction: **"triage desk"**: closer to an email client or Linear's inbox than a SaaS analytics dashboard. Constraints:

| Decision | Choice | Why |
|---|---|---|
| Layout | **Split view** on desktop: list column (≈ 420 px) + detail pane. On mobile the list and the detail are separate screens. | The task is "scan, pick, act". A detail drawer or modal hides the list; a split keeps the next gig one keystroke away. |
| Density | List rows ~72 px, two lines (title; meta), no card boxes. Rows separated by 1 px `border` lines. | Cards with equal weight is the generic tell; rows scan faster. |
| Palette | The brand palette as is (`brand/README.md`): white page, `bone` sidebar, `ink` text and primary buttons, `stone` secondary text. **Orange only for the score of strong matches** (≥ 85 on `flare-600` with white text; 70–84 `flare-700` text on `flare-50`) and the one primary action. Red flags `danger` on `danger-soft`; paid/hired `success`. | Orange under 10 % of a screen (brand rule). No purple, no gradients. |
| Type | Inter (brand font, not a default here: it's the brand guide's UI face). Scores, budgets, counts and times use **tabular numbers** (`tabular-nums`). Post titles 15 px/500; meta 13 px `stone`. Fraunces only in quotes (none in the app). | Numbers line up when scanning a column. |
| Radius | 6 px on controls and rows' hover fill, 10 px on panels; no pill shapes except the status chips. | Not "rounded everything". |
| Elevation | No shadows on content. Borders only. The sidebar's active item keeps its existing subtle shadow. | Flat, calm, operational. |
| Icons | lucide, 16 px, stroke 1.75, always with a text label or an `aria-label`. No emoji. | Consistent with the sidebar. |
| Motion | Functional only: 120 ms colour/opacity on status change; a "3 new gigs" bar at the top of the list that the user clicks to insert (the list never jumps under the cursor); a pulsing dot while a draft is being written. No scroll reveals, no hover lifts. `prefers-reduced-motion` turns the pulse off. | Live updates must be understandable, not distracting. |
| Empty / loading / error | Every view defines all three (section 6). Loading uses fixed-height skeleton rows (no layout shift). | |

Keyboard (desktop, list focused): `j`/`k` next/previous, `Enter` open, `s` save, `d` dismiss (with undo), `o` open the post on Reddit. Shown in a small footer hint, not a modal.

## 3. Routes and navigation

The Telegram alert buttons already link to `${APP_ORIGIN}/feed/<matchId>` and `/feed`, so the app pages live at the top level, inside the `(app)` route group (same layout and session check as `/dashboard`):

| URL | Page | Nav item |
|---|---|---|
| `/dashboard` | Overview: today's numbers, setup checklist (finish onboarding, connect Telegram), credits | Overview |
| `/feed` | Match list; on desktop the detail pane says "Pick a gig" | Matches |
| `/feed/[matchId]` | Match detail + draft composer (desktop: list stays on the left) | Matches |
| `/tracker` | Replies the user marked as sent, with their outcome | Tracker |
| `/settings` | Alerts (Telegram link, threshold, daily cap); account (email, plan, credits) | Settings |
| `/profile` | Profile edit, 5 changes a week (built later: `docs/onboarding/profile-edit.md`) | Profile |

- `app-nav.ts` changes to these hrefs. The sidebar becomes a client component that marks the active item by `usePathname()` prefix (today `activeHref` is hard-coded).
- **Mobile:** a fixed bottom tab bar (Overview, Matches, Tracker, Settings) replaces the header-only shell, which has no nav at all today.
- `proxy.ts` adds `/feed`, `/tracker` and `/settings` to its matcher (signed-out visitors go to `/login?next=…`).
- A signed-in user who hasn't finished onboarding and opens `/feed`, `/tracker` or `/settings` gets the onboarding call to action instead of an empty or erroring page (the alerts API returns 403 for them; the feed returns an empty list).

## 4. How the UI talks to the API

Client components call the `/api/v1` routes with `fetch` (same origin, so the `Origin` check passes). Server components may read the same data through the server functions directly, as `/dashboard` already does, for the first paint.

- **`apiFetch(url, init)`** (new, `src/lib/api-client.ts`): JSON in and out, returns `{ ok: true, data } | { ok: false, status, code, message, retryAfter? }`. A network failure becomes `{ ok: false, status: 0, code: "NETWORK" }`. 401 sends the browser to `/login?next=<current path>`.
- **One table of user-facing messages per error code** (`src/lib/api-errors.ts`): `INSUFFICIENT_CREDITS`, `DAILY_LIMIT`, `PLAN_EXPIRED`, `UNAVAILABLE`, `RATE_LIMITED` ("Try again in N seconds"), `MAX_VERSIONS`, `NO_OTHER_PROJECT`, `VERSION_CONFLICT`, `MATCH_WITHDRAWN`, `TELEGRAM_UNAVAILABLE`, `NETWORK`… Unit-tested; the server's `message` is the fallback.
- **`usePoll`** (new hook): calls a function on an interval while a condition holds, stops on done, gives up after a time limit, pauses while the tab is hidden, never overlaps two calls. Used by the draft composer and the Telegram link flow.
- **Idempotency keys:** each "Draft reply" or rewrite click makes a `crypto.randomUUID()` and reuses it on retry, so a double click or a retried request is never charged twice.
- **Toasts** (sonner) for "Saved", "Dismissed · Undo", and errors that aren't tied to a form field.

Tests follow the onboarding convention: the web tests run in Node (no DOM), so logic lives in small `.ts` modules with unit tests (error mapping, poll scheduling, formatters, reducers), and pages are checked in a real browser (Playwright) at the end of each UI phase.

## 5. The pages

### 5.1 Matches (`/feed`)

- **Header:** "Matches", a two-way switch **Best · All** (`view`), and a filter row: job types (up to 3 of the user's categories), **Paid only** (`pay=paid`).
- **Row:** score (tabular, coloured by band), title (one line, truncated), then meta: `r/community · 2h · $400–600 fixed · Remote`; the one-line reason in `stone`; small chips for `Red flags (2)`, `Also in r/a, r/b`, and the status (`Saved`, `Replied`). New (unseen) rows have a 6 px `flare-500` dot. A row with `aiStatus` pending/running shows the score with a faint "checking" mark (the AI re-scorer is off for the MVP, so this is rare).
- **Paging:** "Load more" at the end of the list (`nextCursor`), plus infinite scroll when the sentinel is visible.
- **New gigs:** polls for new matches while the tab is visible (see section 7) and shows a "N new gigs" bar at the top; clicking it inserts them.
- **Actions:** hover/focus on a row shows Save and Dismiss; dismiss removes the row with an "Undo" toast (undo sets it back to `seen`). Opening a row marks it `seen` if it was `new`.

### 5.2 Match detail (`/feed/[matchId]`)

Top to bottom:

1. **Post:** title, community link(s) (`alsoPostedIn` each linked), posted time, budget, pay type, remote, deadline, the AI summary, then **the post's own text** (collapsed after ~12 lines). Red flags in a `danger-soft` box at the top when present. How to apply (`applyInstructions`) in a `flare-50` box: "The post asks you to: DM with portfolio".
2. **Why it matched:** score + reason; the project or role to cite when known.
3. **Draft composer:**
   - Empty state: **Draft reply** button with the cost ("7 credits · about 300 left").
   - While drafting: a pulsing line "Writing your reply…" (typically 2–4 s).
   - Done: two tabs, **Comment** and **DM**, each an editable textarea (edits are free and local) with **Copy**. Under them: **Open post** (opens `post.url` in a new tab) and **I sent it** (asks which one: comment or DM, then `POST /replies` with the edited text).
   - Rewrite menu: **Shorter**, **More casual**, **More formal** (1 credit each), **Cite a different project** (7), **Custom…** (an instruction, 1). Each creates a new version; a version switcher (v1…v5) shows them, and the 5-version limit disables the menu with the reason.
   - `warning: true` shows "Check this one carefully before sending". A thumbs-down opens a short "What was wrong?" box (`/feedback`).
   - Credit, limit and plan errors show inline with a next step (e.g. `PLAN_EXPIRED` → "Your trial has ended" + a link to settings).
4. **Actions bar:** Save, Dismiss, Open post.

A match that was withdrawn (the post was re-analysed and no longer fits) shows a banner and no Draft button (the draft API refuses it).

### 5.3 Tracker (`/tracker`)

- Filter tabs by status: All, Sent (waiting), Replied, Hired, Lost, No reply, Ghosted.
- Row: post title (links to the match), community, comment or DM, sent time, and a status menu. Choosing **Hired** opens a small form: agreed rate + currency (optional), "This turned out unpaid" (optional).
- Paging with the cursor, "Load more".
- Empty: "Replies you mark as sent show up here, so you can track which ones turn into work."

### 5.4 Settings (`/settings`)

- **Telegram alerts:**
  - Not linked → **Connect Telegram** → `POST /alerts/telegram/link` → open the `t.me` link in a new tab and show "Press Start in Telegram. Waiting…"; poll `GET /alerts/settings` every 2 s (while visible, up to the link's 15-minute expiry) until `linked && enabled`, then "Connected".
  - Linked and on → "Connected" + **Disconnect** (`DELETE /alerts/telegram`, confirm first).
  - Linked and off → the reason: `user_stop` "You turned alerts off" / `blocked` "Telegram says you blocked the bot" / `relinked` "This Telegram account is now connected to another Redlance account", each with **Connect again**.
  - `503 TELEGRAM_UNAVAILABLE` → "Telegram alerts aren't available right now."
- **Alert rules:** minimum score (slider or stepper 50–100, shown with the band colours) and daily cap (1–100); saved with `PATCH /alerts/settings` on change (debounced), with a "Saved" toast.
- **Account:** email (from `/me`), plan and trial end, credits (`/credits`: balance, about how many replies left, used today of the daily cap). Sign out.

### 5.5 Overview (`/dashboard`)

Today the three stat cards are hard-coded zeros. They become real (server-side reads): **new matches today**, **replies sent this week**, **gigs won** (all time). Below: the setup checklist (finish onboarding, connect Telegram, draft your first reply) until done, then the five newest strong matches as rows linking to `/feed/<id>`.

## 6. States every view handles

| State | Treatment |
|---|---|
| Signed out | `proxy.ts` and the layout redirect to `/login?next=…` |
| Not onboarded | The onboarding CTA in place of the page |
| Loading | Skeleton rows of the final height |
| Empty | One sentence on why it's empty and what happens next (e.g. "New gigs that fit your skills appear here, usually within a few minutes of being posted.") |
| Error | Inline message from the error table + Retry; never a blank page |
| Rate limited | "Try again in N s" using `Retry-After` |
| Offline | "Can't reach Redlance. Check your connection." |

## 7. Polling for new matches

The feed is matched on write (the worker writes `matches` rows as posts arrive), so a feed read is one indexed Postgres query. How the list learns about new matches is **an open decision** (Redis cache-aside vs cache-aside plus a server push vs a cheap Postgres `since` query; discussed with the user on 2026-10-20, recommendation: the `since` query, Redis later behind the same server function if measurement ever shows the need). Until it's decided, the list refreshes on focus and with a manual refresh; the poll is phase 2b of the plan.

## 8. Endpoint coverage

| Endpoint | UI that uses it | Phase |
|---|---|---|
| `GET /feed` | Matches list | 2 |
| `POST /feed/:matchId/status` | Row actions, opening a row, detail actions | 2, 3 |
| `GET /feed/:matchId` (**new**) | Match detail, deep links from Telegram | 1, 3 |
| `POST /drafts` | Draft reply | 3 |
| `GET /drafts?matchId=` | Load existing versions on the detail page | 3 |
| `GET /drafts/:id` | Poll a draft or rewrite | 3 |
| `POST /drafts/:id/rewrite` | Rewrite menu | 3 |
| `POST /drafts/:id/feedback` | Thumbs-down | 3 |
| `POST /replies` | I sent it | 3 |
| `GET /replies` | Tracker | 4 |
| `PATCH /replies/:id` | Tracker status menu | 4 |
| `GET`/`PATCH /alerts/settings` | Settings | 5 |
| `POST /alerts/telegram/link` | Connect Telegram | 5 |
| `DELETE /alerts/telegram` | Disconnect | 5 |
| `GET /me` | Settings → account | 5 |
| `GET /credits` | Draft cost line, settings, overview | 3, 5, 6 |
| `GET /health`, `/dev/session` | Ops / dev login (already used) | — |

Not in this build: profile edit (no API yet), the onboarding review-step copy change (waiting for approval), Cognito login, payments.
