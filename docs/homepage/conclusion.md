# Homepage: conclusion

**Status (2026-10-17):** built and merged to `main` (PR #1, 2026-09-28). Several parts of the copy are now out of date with later product decisions; see "Out of date" below.

## In one paragraph

The homepage is the public marketing page at `/`. It is a single long Next.js page made of 11 sections. Its layout, motion and copy structure follow a measured study of attio.com (`attio-teardown.md` in this folder). All of its content is static: it doesn't call the API or the database. Every number, post and draft on it is sample data. It shows what the product will do, not live data.

## How the page is put together

```
app/layout.tsx                 fonts (Inter, Fraunces, Bricolage), metadata, <html>
└─ app/(marketing)/layout.tsx  skip link → AnnouncementBar → SiteHeader → <main> → SiteFooter
   └─ app/(marketing)/page.tsx the 11 sections, top to bottom:
      1 Hero            2 SubredditWall   3 HowItWorks   4 VoiceShowcase
      5 Alerts          6 PromiseQuote    7 TimeBack     8 NicheTabs
      9 Pricing        10 Faq            11 FinalCta
```

`(marketing)` is a **route group**: the brackets keep it out of the URL, so the page is `/`, but it gets its own layout (header and footer) that the app pages (`/dashboard`, `/onboarding`) don't share.

## Where the code is

| What | Where |
|---|---|
| Sections | `apps/web/src/components/marketing/*.tsx` (one file per section) |
| "How it works" story (6 steps with animated mocks) | `components/marketing/how-it-works/` (`index.tsx` holds the step data; `step-nav.tsx`, `mocks.tsx`, `insights.tsx`, `use-story.ts`) |
| Motion helpers | `components/marketing/motion/` (`in-view.tsx`, `streaks.tsx`, `horizon.tsx`) |
| Shared building blocks | `components/marketing/primitives.tsx` (`Frame`, `SectionChip`, `TwoToneHeading`) |
| Copy and content data | `apps/web/src/lib/`: `site.ts` (one-liner and core promise, word for word), `faq.ts`, `nav.ts`, `pricing.ts`, `subreddits.ts` |
| Brand tokens, animations | `apps/web/src/app/globals.css` |
| Logo | `apps/web/src/components/brand/logo.tsx`; files and rules in `brand/README.md` |
| App manifest | `apps/web/src/app/manifest.ts` |

## Techniques worth knowing

- **Server components by default.** Sections with no interaction (`hero.tsx`, `pricing.tsx`, `faq.tsx`, `subreddit-wall.tsx`) render on the server and send no JavaScript. Only the animated parts are client components (`"use client"`).
- **Animations start when visible.** `motion/in-view.tsx` sets `data-inview` on its section, and a CSS rule (`globals.css`, `[data-inview="false"] *`) keeps the animations inside it paused until then. `use-story.ts` does the same for the scripted mocks: it plays a timed sequence of "beats" once.
- **Scroll-linked motion** uses the `motion` library (`useScroll`, `useTransform`, `useSpring`). Examples: the hero's glow dome and the windows that slide out of the hero (`hero-backdrop.tsx`, `hero-stage.tsx`), the word-by-word quote (`promise-quote.tsx`), and the orange horizon (`motion/horizon.tsx`).
- **Header colour follows the section under it.** `header-theme-sync.tsx` watches with an `IntersectionObserver`. When the header is over a section marked `data-header-theme="dark"`, it adds the `dark` class, and the theme tokens switch.
- **Canvas 3D.** `funnel-canvas.tsx` draws a gravity-well funnel on a 2D `<canvas>` with its own perspective maths and particles, inside a `requestAnimationFrame` loop.
- **Reduced motion is respected everywhere.** The mocks jump to their final state, and autoplay is off.
- **FAQ works without JavaScript.** It uses native `<details>`, and FAQPage structured data (JSON-LD) is generated from `lib/faq.ts`. This is the AEO rule from `CLAUDE.md`: question, then a 40–60 word answer.

## Brand in code

- Colours are tokens on `:root` in `globals.css`: `flare-50…700` (orange), `cream`, `ink`, `stone`, `bone`, `feed`, `danger`, `success`. shadcn's `primary` maps to `ink`, so buttons are near-black. The `.dark` class swaps background to `ink` and text to `bone`.
- Fonts come from `next/font/google` in `app/layout.tsx`: Inter (UI and headings), Fraunces (quotes only), Bricolage Grotesque (the wordmark only).
- Orange stays under about 10% of a screen. "Reddit" is never used in branding (see `brand/README.md`).

## How it connects to the rest

- The header's **Log in** goes to `/login` (foundation). **Start free** also goes to `/login` (since 2026-10-21; login creates the account, until Cognito brings a real sign-up).
- Nothing else connects. The homepage reads no data, so later features (feed, insights) won't change it unless we choose to show live numbers.

## Out of date (to fix in a homepage copy pass)

These came from product decisions made after the page was built:

| Problem | Where |
|---|---|
| Plans are Free / Pro / Agency, priced in rupees with UPI. The decision is no free tier: a 5-day trial, then standard, Max and Agency, with draft **credits** (not "unlimited") | `lib/pricing.ts`, `pricing.tsx:45-46`, `faq.ts:22,37`, `alerts.tsx:25`, `voice-showcase.tsx:36`, the "Pro" badges in `how-it-works/index.tsx` |
| `/privacy` and `/terms` don't exist ("Start free" and the announcement link pointed at a missing `/signup`; they go to `/login` since 2026-10-21) | `lib/nav.ts:18,113,144-145`, `lib/pricing.ts:25,39` |
| Says users are "connected to subreddits". Now one central catalogue is polled for everyone | `how-it-works/index.tsx:45,49-50`, `niche-tabs.tsx:87,120`, `lib/pricing.ts:23`, `faq.ts:32`, `lib/nav.ts:28` |
| "More than 150 hiring subreddits". The catalogue has 238 active | `faq.ts:17` |
| Portfolio links and "learns your tone from replies you've written". There is no portfolio step (GitHub instead), and voice is learned from edits | `how-it-works/index.tsx:83,91-93`, `voice-showcase.tsx:15-16,31`, `faq.ts:27` |
| "2–3 min between feed checks". Ingestion polls each group every 5 min | `time-back.tsx:11` |
| Announcement says "Early access … in India". Markets are US/UK first | `lib/nav.ts:17` |
| The SEO pages it links to don't exist yet (`/reddit-freelance-jobs`, `/best-subreddits-for-freelancers`, …) | `lib/nav.ts`, `hero.tsx:21`, `subreddit-wall.tsx:23`, `niche-tabs.tsx` |
| No HowTo structured data, no `sitemap.ts` / `robots.ts` | — |

## How to see it

`npm run dev`, then open `http://localhost:3000/` (or `:3001` if port 3000 is taken).
