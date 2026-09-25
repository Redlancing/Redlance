# Attio homepage teardown → Redlance homepage plan

Source: https://attio.com, studied 2026-09-25 in a headless browser (desktop 1440 px, phone 390 px). Values below were read from the live page's computed styles, not estimated.

**Rule for using this:** we copy the *structure, layout system, interaction patterns and copywriting formula*. We do **not** copy Attio's text, logo, product screenshots, illustrations, customer logos, the "Universal Context™" name, or its paid font (Tiempos). Every product mock is our own UI, built in React like theirs.

---

## 1. Page anatomy (top to bottom, desktop)

| # | Attio section | What it is | Redlance equivalent |
|---|---|---|---|
| 0 | Announcement bar | Black 48 px strip, one centred link with →, closable | "New: Telegram alerts in under 2 minutes →" (or latest guide) |
| 1 | Header | Logo · Platform ▾ · Resources ▾ · Developers · Customers · Pricing · **Sign in** (outline) · **Start for free** (dark). Sticky; turns dark over dark sections | Logo · Product ▾ · Guides ▾ · Subreddits · Pricing · **Log in** · **Start free** |
| 1a | Mega menu (Platform) | 3 columns of *title + one-line description* under small grey column labels, plus a tinted right panel ("Attio for…", "Get started") | Columns **Find / Reply / Grow**, right panel **"Redlance for"** → niche SEO pages (web devs, video editors, designers, writers) |
| 2 | Hero | Pill link (news) → 4-word H1 → 2-line grey subtitle → two buttons → large **app-window mock** (traffic-light dots) whose cells animate from "AI is thinking…" to values | Pill → short H1 → **one-liner (verbatim)** → Start free + See how it works → **Matches table mock** where Match and Why cells animate "Scoring…" → 94 / reason |
| 3 | Logo wall | 2×5 grid of customer logos in bordered cells, some with ↗ | **Subreddit wall**: 2×5 grid of hiring subreddits we watch (text, monospace), each linking to its SEO page. No Reddit logos |
| 4 | Intro statement | Blue chip "Platform" + big **two-tone H2** (bold claim + grey detail) | Chip "How it works" + two-tone H2 (draft in §3) |
| 5 | **Sticky feature walkthrough** (the core of the page, ~6,500 px) | Left column: sticky list of 5 steps (active = dark text + 1 px blue bar, others faded). Right: per step a two-tone H3, a big interactive mock, then a 2-up grid of sub-cards (title + grey line + small illustration). On phone the list becomes a **sticky horizontal tab strip** | Our 5 steps: **Find → Match → Draft → You send → Track** (mocks listed in §4) |
| 6 | "Live from day one" | Centred chip + two-tone H2 + one outline button, then a record/profile mock fading out at the bottom | "Set up in two minutes": freelancer **profile mock** (skills, portfolio links, voice summary) |
| 7 | Dark showcase | Black section, small grey eyebrow, 96 px white title with ™, **glowing gradient arc** (planet horizon), then a 5-column row of icon cards | Dark moment for our one big idea (e.g. "Replies in your voice"), **orange-glow arc**, 5 benefit cards |
| 8 | Dark split: "Signals" | Left: chip, two-tone H2, "See more", then an **autoplay accordion** (3 items, progress bar under the active one). Right: animated wireframe (2 canvases) | Alerts: **Telegram / Email / Web** accordion with autoplay progress; right: animated alert visual |
| 9 | Dark "stack, connected" | Centred heading + subtitle + button, then a **marquee** of rounded app-icon tiles | Optional. Could be a marquee of skills or subreddits; skip in v1 |
| 10 | Dark developer block | "SDK. API. MCP." two-tone + View docs, geometric line art | Skip (not our audience) |
| 11 | **Curtain-reveal quote** | Dark section scrolls up to uncover a pinned, dot-grid section with a 48 px **serif** testimonial | Only with a **real** beta-user quote. Until then, skip or use a signed founder's note |
| 12 | Scale stats | 2×2 stats (32 px numbers, blue left bar) over a **curve that draws on scroll** | Only with real numbers from our database (posts scanned, subreddits watched, median alert time). Hide until we have them |
| 13 | Customer stories | Two-tone H2 + Read more, **tabs of 4 logos**, active tab shows a case-study split (text left, photo right) | Pre-launch: **niche tabs** (Web dev · Video · Design · Writing), each showing a real example post and how Redlance handled it. Case studies later |
| 14 | Changelog | Two-tone H2 + View all, 4 dated cards separated by 1 px lines | "What's new" (keeps the site fresh; good for SEO) |
| 15 | Newsletter row | Two-tone H3 left, email input + dark Subscribe right | "Best gigs of the week, in your inbox" |
| — | *(not on Attio)* | | **FAQ** with question headings + 40–60 word answers + FAQ JSON-LD (required by CLAUDE.md, AEO) |
| 16 | Final CTA (dark) | 56 px centred line "Agentic revenue runs on Attio." + two buttons, barcode texture | "Freelance gigs, found first." + Start free / See pricing |
| 17 | Footer (dark) | Logo left; 4 columns with grey headings; "New" badges; ↗ on external links | Product · Redlance for · Guides · Company · Legal, plus "Not affiliated with Reddit, Inc." |

Page length: 17,600 px desktop, 16,200 px phone.

---

## 2. Design system (measured)

### Colour (converted from Attio's LAB values)

| Attio role | Attio value | Redlance mapping |
|---|---|---|
| Page background | `#FFFFFF` | White `#FFFFFF` |
| Secondary background (feature area) | `#FAFAFB` | Cream `#FCF8F4` |
| Text | `#1C1D1F` | Ink `#1A1512` |
| **Grey half of two-tone headings, subtitles** | `#6F7988` | Stone `#6B625A` (5.7:1) |
| Nav text | `#2E3238` | Ink at ~90% |
| Borders / header line | `#E4E7EC` | Border `#ECE6DF` |
| Rails (vertical frame lines) | `#D3D8DF` | `#E2DAD1` |
| Primary button | `#202124` with `#505967` border | **Decision needed** (see §5) |
| Outline button border | `#CAD0D9` | `#E2DAD1` |
| Accent (chips, UI highlights) | Blue `#245BC2` on `#E8F0FF` | Flare 700 `#B8340A` on Flare 50 `#FFF5EE` |
| Dark sections | `#101010` | Ink `#1A1512` or deeper `#120E0B` |

Attio uses its accent (blue) **only** for chips, the active-step bar, stat bars and inside product mocks. Buttons are black or white. That restraint is a big part of why it looks premium.

### Type

| Use | Attio | Size / line-height / tracking / weight |
|---|---|---|
| H1 | Inter Display | 64 / 61 (0.95) / −0.02em / 600 (56 px on smaller screens) |
| H2 (two-tone) | Inter Display | 40 / 44 / −0.01em / 500 |
| H3 (feature, two-tone) | Inter Display | 24 / 27.6 / −0.01em / 500 |
| Showcase title | Inter Display | 96 / 96 / −0.024em / 600 |
| Final CTA line | Inter Display | 56 / 56 / −0.015em / 500 |
| Stats | Inter Display | 32 / 500 |
| Body | Inter | 16 / 22 |
| Subtitle | Inter | 18 / 23.4 / 500, grey, max-width 486 px |
| Buttons, nav | Inter | 14–15 / 500 / −0.005em |
| Quotes | Tiempos Text (serif, paid) | 48 / 52 / −0.015em / 400 |
| Small labels / code | JetBrains Mono | |

Redlance: see decision 2 in §5.

### Components

- **Buttons:** 36 px tall (32 px for small "See more" style), radius 10 px, padding 12 px, 14 px/500. Primary dark with a subtle top-to-bottom gradient; secondary white with a light border; small text buttons end in →. Transitions 300 ms `cubic-bezier(0.2, 0, 0, 1)`.
- **Section chip:** 14 px/500, accent text on tinted background, padding 0 6 px, radius 8 px, height 24 px.
- **Two-tone heading:** one element; first sentence in ink, rest wrapped in a span in grey. The signature device of the whole page.
- **Header:** 68 px bar + 48 px announcement (116 px total). Sticky, white at 95% opacity, 1 px bottom border; restyles to dark while over dark sections.
- **Frame and rails:** 1440 px max width, 24 px outer gutter, 1 px vertical lines on both sides of the content and 1 px dividers between cells. Everything sits in a visible grid of hairline cells.
- **Textures:** dot grid (`radial-gradient`) behind mocks and the quote; "barcode" vertical-line strips at section joins (`repeating-linear-gradient`); soft blue-white gradient under the hero mock.
- **Product mocks:** real HTML/React UI (tables, kanban, email composer, workflow canvas, chat), not screenshots. Traffic-light window chrome in the hero. Lower parts fade to white.
- **Mega menu:** white panel, radius ~16 px, soft shadow; item = 15 px/500 title + grey description; right column on a tinted panel.
- **Intercom-style chat bubble** bottom right (we don't need one).

### Motion (framer-motion; respects `prefers-reduced-motion`)

1. Hero table cells type in ("AI is thinking…" → value).
2. **Scroll-spy sticky steps:** the left list highlights the section in view; the list is `position: sticky`.
3. Mocks animate when scrolled into view: text typing into the email composer, workflow nodes showing "Running", chat answer streaming.
4. **Autoplay accordion** with a progress bar filling under the active item.
5. **Marquee** of icon tiles.
6. **Curtain reveal:** a dark section scrolls up over a sticky, full-height quote section (`-mt-[100svh]` + `sticky top-0 h-svh`).
7. Growth curve drawn on scroll.
8. Header colour swaps light ↔ dark per section.

### Phone (390 px)

- Hero CTA becomes a **full-width email input + big dark button** ("Send me a demo"), with "Talk to sales →" as a text link below.
- The sticky side list becomes a **sticky horizontal scrolling tab strip** under the header.
- The hero mock switches to a narrower "home" view instead of the wide table.
- Menu becomes a hamburger. No sideways scroll (checked).

---

## 3. Copywriting formula

1. **H1 = 4 words that name a new category.** "Welcome to agentic revenue." Confident, no product name.
2. **Subtitle = "[Product] is the [category] that [verb] X, [verb] Y, and [verb] Z [time]."** Our one-liner already has exactly this shape: "Redlance is an AI tool that finds…, matches…, and drafts…"
3. **Two-tone headings everywhere:** a short bold claim, then grey detail with vivid, concrete specifics. "The intelligent system that never sleeps. *Picks up leads at 2am. Catches renewals before they slip.*"
4. **Short sentences, rhythm of three.** "SDK. API. MCP." / "Keep more. Grow more."
5. **Card titles are 2–5 word punchlines:** "Agents dig. You close." "It logs itself." "Ask, and it's there." Then one plain line.
6. **One-word chips** label each section: Platform, Self-building, Signals, Connectivity.
7. **One coined, owned concept** (Universal Context™) gets its own dark showcase.
8. **CTAs:** "Start for free", "Talk to sales", "See more", "View docs", "Read more".

### Redlance drafts in the same formula (for review, not final)

- **H1 options:** "Get hired off Reddit." · "Freelance gigs, found first." · "Reply first. Get hired."
- **Subtitle (verbatim, required):** "Redlance is an AI tool that finds freelance jobs on Reddit, matches them to your skills, and drafts replies in your voice."
- **Intro H2:** "Your gig radar never sleeps. *Catches [Hiring] posts at 2am. Scores them against your skills. Has a reply ready before your chai cools.*"
- **Step H3s:**
  - Find: "Every hiring post, one feed. *We watch the subreddits so you don't refresh them all day.*"
  - Match: "Know what's worth it. *Each post gets a 0–100 score and a one-line reason.*"
  - Draft: "Sounds like you, not a bot. *Short, specific replies that link your single best portfolio piece.*"
  - You send: "You always press send. *Redlance never posts for you. Edit, open the post, reply.*"
  - Track: "See what gets you hired. *Sent, replied, hired, paid, all in one board.*"
- **Card punchlines:** "We dig. You pitch." · "Red flags, flagged." · "Two minutes, not twenty." · "No [For Hire] noise."
- **Coined concept for the dark showcase:** e.g. "Voice Match" (replies learned from how you write). Don't add ™ unless we actually file it.
- **Final CTA:** "Freelance gigs, found first."

All claims must stay true to CLAUDE.md: never auto-post, "posted budgets" not "market rate", no invented stats, logos or testimonials.

---

## 4. Build checklist (apps/web)

**Libraries:** `motion` (framer-motion) for scroll/animation; shadcn `navigation-menu`, `accordion`, `tabs`, `input`, `badge`; lucide icons; a neutral display sans (see §5).

**Layout primitives**
- [ ] `SiteFrame` (1440 max, 24 px gutter, rails) and `Cell` grid with hairline dividers
- [ ] `Section` with light / cream / dark variants (dark also flips header)
- [ ] Textures: dot grid, barcode strip, hero gradient

**Components**
- [ ] `AnnouncementBar` (closable, remembered)
- [ ] `SiteHeader` (sticky, dark-aware) + `MegaMenu` + mobile drawer
- [ ] `Button` variants: primary, outline, text-with-arrow (sizes 32 / 36 / 48 phone)
- [ ] `SectionChip`, `TwoToneHeading`
- [ ] `HeroMock` (app window + animated Matches table)
- [ ] `SubredditWall`
- [ ] `StickySteps` (scroll-spy; phone tab strip) + `StepPanel` + `SubCard`
- [ ] Mocks: `FeedMock`, `MatchTableMock`, `DraftComposerMock`, `OpenPostMock`, `TrackerBoardMock`, `ProfileMock`
- [ ] `DarkShowcase` (orange glow arc) + `IconCardRow`
- [ ] `AutoplayAccordion`
- [ ] `NicheTabs` (replaces customer stories pre-launch)
- [ ] `ChangelogCards`, `NewsletterRow`
- [ ] `FAQ` + FAQPage JSON-LD
- [ ] `FinalCTA`, `SiteFooter` (with "Not affiliated with Reddit")
- [ ] Reduced-motion fallbacks for every animation

**Content we still need**
- [ ] Final H1 and the coined concept name
- [ ] The first niche (Phase 0 is one niche) and its subreddit list
- [ ] Pricing in INR for the pricing section/page
- [ ] Real numbers and real quotes before sections 11–13 go live

---

## 5. Decisions (made 2026-09-25)

1. **Primary buttons: ink/black like Attio.** Orange only for chips, highlighted words, the top match, the logo, the glow arc and product mocks. Applied: shadcn `primary` = `ink`.
2. **Headlines: neutral sans like Attio.** Inter (its optical-size axis gives the Display cut). Fraunces only for quotes (`font-serif`); Bricolage only for the wordmark (`font-wordmark`). Applied.
3. **Hero H1: "Get hired off Reddit."** with the verbatim one-liner as the subtitle.
4. **Backgrounds:** white page, cream for the feature walkthrough, ink for dark sections. Applied (`--background` = white).
5. **v1 scope (recommended, not yet confirmed):** sections 0–8, 13 (niche tabs), 14–17 and the FAQ; add the quote, stats and case studies once they're real.

---

## 6. Motion, measured (2026-09-25)

Measured by recording every element whose inline style changes while scrolling, plus `document.getAnimations()` and hover probes.

| Effect | How Attio does it | Redlance version |
|---|---|---|
| **Horizon arc** (dark showcase) | Rim = two layers (blurred glow `blur(10px)` at 45% + sharp `blur(2px)`) under a 1728px body circle; a `clip-path: inset(... calc(X% ...) ...)` wipes the rim in **left → right tied to scroll**, spring-smoothed, finishing as the section reaches the top; slow `hue-rotate`/`saturate` drift | Same structure in Flare orange; `useScroll` + `useSpring` drive the clip and opacity |
| **Heading reveal** | `filter: blur(2.5px)`, `opacity 0`, `translateY(4px)` → sharp, spring | `BlurReveal` on section headings |
| **Hero on scroll** | Mock scales 0.96 → 0.95; floating panels around it scale from their own corners (`transform-origin` per corner); hero text fades with blur | Scroll-linked scale + floating alert / red-flag / hired cards |
| **Light streaks** | Two layers: an even grid of 1px lines every 8px at 3.5% white (`repeating-linear-gradient`) over the whole area, plus ~6 faint highlights (2px scaled to 1.3–2px, 360px tall, `rgba(255,255,255,0.5)` mid, opacity 0.1–0.25) travelling down at ~225px/s | `Streaks`: same grid, 6 highlights, same size, opacity and speed; no mask |
| **Looping details** | `pipeline-radar-ring` pulses, chips `bob`, workflow connectors `border-draw` (`stroke-dashoffset`), skeleton shimmer, "Thinking" gradient sweep via `background-clip: text` | Radar with subreddit chips, drawn pipeline connectors, text shimmer on "Scoring…" |
| **Graphs** | SVG path (`preserveAspectRatio="none"`) revealed with `infra-reveal-to-right` | Insight chart drawn on view (sample data inside a product mock only) |
| **Buttons** | Primary gets a radial highlight from the top on hover (`radial-gradient(at 50% -10%, lighter, base)`) | Top-glow overlay on hover |
| **Marquee** | `translate3d` offset tied to scroll | Not needed yet |

All of it is disabled or jumps to the end state under `prefers-reduced-motion`.

### Platform walkthrough interactions (measured 2026-09-25)

| Behaviour | Attio | Redlance |
|---|---|---|
| Active indicator | One 2px bar that springs between items (Motion `layoutId`), on the frame's edge | Same, in Flare 500 |
| Item colours | 18px/500; idle very light grey, hover darker, 320ms ease-out colour change | Same timing; idle kept at 5.2:1 contrast for readability |
| Active switch | When the next step's top reaches ~mid-viewport | Same (`rootMargin: -45% 0 -50% 0`) |
| Click | JS eased scroll ~1.2s (fast start, long settle), no `#hash`, lands flush under the header (`scroll-margin-top` = header height) | Same (1.1s, `[0.16, 1, 0.3, 1]`), cancels on wheel/touch/key, focuses the step, plain link without JS |
| Phone tabs | Cells with 1px dividers (`gap-px` on border colour), active cell shaded, hover lightens | Same |
| Step headings | Static; only section headings blur in | Same |
| Demo cards | Blur in (`blur → 0`, opacity) staggered when in view; play once, never replay; start ~350px into view | Same |
| Kanban | Card lifts (y −24, scale up, shadow 0 → 0.18), arcs to the next column, drops | Lift (y −14, scale 1.05, −2° tilt) with an orange ring/shadow layer, then drops and "Hired" pops in |

### Dark block: Universal Context cards and Signals (measured 2026-09-25)

| Behaviour | Attio | Redlance |
|---|---|---|
| Cards under the arc | 5 static square cells (`lg:aspect-square`), icon top, text bottom (`justify-between`), no hover; stacked and centred on phones | Same, 5 cells ("Better with every edit" added), two-line copy so titles align |
| Signals layout | Left column fixed height (560px): chip, H2, small outline "See more" at top; list pinned to the bottom | Same, with "See plans" |
| Items | Titles stay bright; inactive items are buttons with hover underline; active opens description + 2px progress (height/blur/opacity) | Same |
| Timing | Progress fills in ~5s, then the next item opens; a click jumps and restarts the timer (autoplay continues) | Same; also pauses on hover/keyboard focus and off screen; no autoplay with reduced motion |
| Right visual | One canvas of white line art that changes scene per item (funnel with streaking particles, radar rings with a descending line, tilted orbits with satellites) | SVG + SMIL line art: radar (orange ping), funnel (one orange match drops out), orbits (orange top match); crossfade with blur; paused off screen |

### Signals funnel, reconstructed (2026-09-25)

Attio's funnel is a small 3D canvas renderer (recorded via canvas-call logging, then read from its bundle to get exact parameters). Our `funnel-canvas.tsx` is an independent implementation of the same model:

- **Surface:** radius `3.2·(1−d)^3.2`, height `−7.5·d^2.2` (d = depth 0…1, clamped).
- **Rings:** 13 at d = −0.2, −0.12, −0.05, 0.04, 0.12, 0.22, 0.33, 0.45, 0.57, 0.68, 0.78, 0.87, 0.94; 96 segments; alpha `0.5·smoothstep(−0.2, 0.28, d)`; colour blends toward the background with depth (`smoothstep(0.15, 0.75, d)`, up to 90%).
- **Spokes:** 16, sampled with `d = −0.2 + 1.2·(1−(1−t)²)` over 56 steps; alpha `0.42`, fading in with `smoothstep(−0.26, 0, d)`.
- **Occlusion:** 24 × 48 surface quads filled in the background colour; everything sorted back to front (lines biased 0.6 nearer).
- **Camera:** elevation 52°, distance 6.6, target y −1.2, focal `0.92·height`, centred; depth fade `0.1 + 0.9·(1 − smoothstep(0.32·dist, dist + 9.3, z))`; pointer tilt ±3.5° (smoothing τ 0.18s, desktop fine pointers only).
- **Particles:** 12 on spoke angles `(5i mod 16)/16·2π`, depth advancing 0.07/s; 1.6px additive trail over 0.13 depth; head = 5px glow + 2.4px core, shrinking `1−0.5d` and dimming `1−0.9d³`.
- **Mask:** vertical fade 0→20% and 90→100%.
- **Palette mapping:** lines `156,147,139` (warm grey, same luminance as Attio's `143,153,168`), trails `255,176,140`, heads white.
