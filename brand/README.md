# Redlance brand

Logo: **Feed pick**. Three feed lines; the middle one is orange and pointed, the right gig picked out of the feed.

## Files

| File | Use |
|---|---|
| `logo-mark.svg` | Mark on light backgrounds (site header, docs) |
| `logo-mark-on-dark.svg` | Mark on dark backgrounds |
| `favicon.svg` | Browser favicon (in the app as `apps/web/src/app/icon.svg`) |
| `app-icon.svg` | App / PWA icon, rounded square |
| `telegram-avatar.svg` | Telegram bot photo (square, Telegram crops it to a circle) |
| `png/favicon-16.png`, `png/favicon-32.png` | Favicon fallbacks |
| `png/apple-touch-icon.png` | iOS home screen, 180 px |
| `png/app-icon-192.png`, `png/app-icon-512.png` | PWA manifest icons |
| `png/telegram-avatar-512.png` | Upload via BotFather `/setuserpic` |
| `png/logo-mark-512.png` | Transparent mark for social / directories |

## Type

- **Wordmark:** Bricolage Grotesque 700, letter-spacing `-0.035em`, one colour (ink on light, bone on dark). Set in code, not as an image. Lockup = mark + wordmark, gap ≈ 0.24 × font size, mark ≈ 1.15 × font size.
- **Headlines, body and UI:** Inter (the optical-size axis gives the Display cut at large sizes). Headlines 500–600 with tight tracking.
- **Serif accents** (testimonial quotes): Fraunces with the `SOFT` axis at 100.

## Colours

The look (modelled on Attio's layout, see `docs/research/attio-teardown.md`): white page, cream feature sections, ink dark sections, near-black buttons, and orange used sparingly for the one thing that matters.

| Token | Hex | Use |
|---|---|---|
| White | `#FFFFFF` | Page background, cards, inputs |
| Cream | `#FCF8F4` | Secondary sections (the feature walkthrough area) |
| Sand | `#F5EFE8` | Muted fills, hovers |
| Border | `#ECE6DF` | Dividers, outlines |
| Ink | `#1A1512` | Text, **primary buttons**, dark sections |
| Stone | `#6B625A` | Secondary text (5.7:1 on cream) |
| Bone | `#F7F2EC` | Text on dark |
| Flare 50 / 100 | `#FFF5EE` / `#FFE8D9` | Highlight boxes behind key words, selected items |
| Flare 400 | `#FF7A45` | Orange text on dark (7.0:1) |
| Flare 500 | `#FF5A1F` | Logo, icon backgrounds, large shapes. Never for text |
| Flare 600 | `#D63F0C` | Orange fills that carry white text, e.g. a top-match score (4.6:1) |
| Flare 700 | `#B8340A` | Orange text and links on light (5.6:1) |
| Red | `#B91C1C` on `#FEF2F2` | Red flags on job posts |
| Green | `#15803D` on `#F0FDF4` | Paid, hired, won |
| Feed grey | `#CFC8BD` / dark `#4A423C` | Logo side bars only |

## Rules

- Buttons are ink (primary) or white with a border (secondary), like Attio. Orange is for section chips, highlighted words, the top match, the logo and the glow in dark showcases. Keep it under ~10% of a screen.
- White text on orange only on Flare 600, never Flare 500 (fails contrast).
- Never put "Reddit" in the logo or name, never use Reddit's alien mascot, and never imply an official connection. A plain word "Reddit" in a highlight box is fine; the alien is not.
