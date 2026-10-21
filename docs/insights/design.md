# Subreddit insights: design

**Status (2026-10-21):** agreed with the user; build plan in `plan/README.md`. Product rules this follows: CLAUDE.md "Subreddit insights", rules 3, 4, 7 and 8.

## What it is

Per subreddit, numbers that help a freelancer decide where to look and how to reply: how much hiring happens there, how much of it fits them, what it pays, when it's posted, and how risky or crowded it is. Everything comes from data we already store (RSS fields + the one AI analysis each post gets at ingestion + the user's matches). **No new AI calls.**

## Decisions (user, 2026-10-21)

- **Which subreddits:** the ones that gave this user at least one match in the last 30 days, most matches first; a "Browse all" tab lists every active catalogue subreddit.
- **Who:** the trial (while it runs) and every paid plan, behind one check (`insightsAllowed`, like `aiAllowed`) so it can move later. An ended trial sees a locked page.
- **Currency:** posted budgets are shown per original currency, never converted.
- **Cross-posting insight:** dropped.

## The eleven insights

Window: the last **28 days** ("this month"), compared with the 28 days before where a trend is shown. A **hiring post in r/x** is a post whose community is x and whose analysis says `kind = 'hiring'`; a cross-post copy (`duplicate_of` set) counts in its own subreddit using its original's analysis. Every insight needs **≥ 20 data points** (rule 8) or it shows "Not enough data yet (12 of 20)" instead of a number. The server applies the thresholds: numbers under the threshold never reach the browser.

| # | Insight | Example | Source | Data points that must reach 20 |
|---|---|---|---|---|
| 1 | Hiring posts per week | "~35 a week, up from 28" | `job_posts.community, posted_at` + analysis `kind` | hiring posts in the window (trend: both windows) |
| 2 | Strong fits | "1 in 5 is a strong fit" | the user's matches with score ≥ 60 (the Best view) ÷ hiring posts, both counted since `max(window start, onboarded_at)` | hiring posts in that span |
| 3 | Posted budgets | "USD per hour: usually $15–35, middle $22" | `budget_min/max, currency, budget_unit`; a post's value is the midpoint (or the one given) | budgets in that currency + unit; up to 3 groups shown, largest first |
| 4 | Busiest hours | "Most posts arrive 6–10 pm your time; weekdays" | `posted_at`, shown in the profile's time zone | hiring posts |
| 5 | Most-asked skills | "Video editing 45 %, Thumbnails 20 %" | analysis `skill_ids` (names from the taxonomy) | hiring posts; a skill shows only with ≥ 3 mentions; top 5 |
| 6 | Paid share | "92 % paid · 5 % rev share · 3 % unpaid" | analysis `pay_type` | hiring posts |
| 7 | Red-flag rate | "1 in 8 has a red flag, mostly vague pay" | analysis `red_flags` | hiring posts |
| 8 | How crowded | "3 freelancers advertise per hiring post" | `coalesce(analysis kind, pre_kind)`: for-hire ÷ hiring (for-hire posts skipped before analysis still count via `pre_kind`) | hiring posts |
| 9 | Budget stated | "40 % state a budget" | analysis `budget_min/max` present | hiring posts |
| 10 | Remote share | "95 % remote" | analysis `remote` | hiring posts |
| 11 | Repeat clients | "30 % come from people who hired here before" | `job_posts.author`: an earlier hiring post by the same author in any catalogue subreddit in the 180 days before | hiring posts with a known author, **and** stored history reaching ≥ 28 days before the window ("Building history" until then) |

Wording rules: "posted budgets", never "market rate" (rule 8). Repeat clients is a percentage only: no usernames, no per-person counts (rule 7; per-client history is §7.4, a separate feature). Nothing that needs flair, votes, comments or karma (rule 4).

## How it works

```
worker (hourly, one runner via the poller lock)        web (on request)
  refreshSubredditInsights(db)                            GET /api/v1/insights
    one SQL pass over 56 days of posts                      ├─ insightsAllowed? (plan, trial end)
    → subreddit_insights: one row per subreddit             ├─ "mine": subreddits with ≥ 1 match in 30 days
      (counts, histograms, budget percentiles)              │    + per-user fit share (matches table)
                                                            └─ shared rows from subreddit_insights,
                                                               thresholds applied, hours shifted to
                                                               the user's time zone
```

- **Shared table, not per user, not Redis.** Ten of the eleven insights are the same for everyone, change slowly and cost a scan of weeks of posts, so they're computed once an hour into `subreddit_insights` (Postgres). Only "strong fits" is per user, read at request time from the indexed `matches` table. This is the "shared, expensive, slow-changing" case where precomputing pays off.
- **Table `subreddit_insights`** (one row per subreddit; replaced on each run): `subreddit`, `computed_at`, `window_start`, `hiring_posts`, `hiring_posts_prev`, `for_hire_posts`, `budget_stated`, `pay_counts jsonb`, `remote_counts jsonb`, `red_flag_posts`, `red_flag_counts jsonb`, `skill_counts jsonb` (top 20), `budgets jsonb` (`[{currency, unit, n, p25, median, p75}]`), `hour_slots int[336]` (UTC half-hours of the week, Monday 00:00 = 0; half-hours so India's +5:30 lines up), `known_author_posts`, `repeat_author_posts`, `history_start`. Raw counts are stored; thresholds and wording are applied when reading, so they can change without recomputing.
- **Busiest hours** are converted from UTC slots to the user's zone with the zone's current offset (a DST shift moves a bar by an hour for a few weeks; acceptable). Shown as 24 hourly bars plus one sentence naming the busiest 4-hour stretch and whether weekdays or weekends dominate.
- **Percentiles** with `percentile_cont` per (currency, unit), ignoring zero and empty budgets.
- **Cost:** one SQL pass an hour over roughly 2 × 28 days of posts (tens of thousands of rows at today's ~800 hiring posts a day), indexed by `(community, posted_at)`; no AI, no Redis.

## The pages

- **`/insights`** (nav item "Insights"): tabs **Yours** (the user's subreddits) and **Browse all** (every active catalogue subreddit, by hiring posts a week, with a filter box). A dense table-like list: subreddit, posts a week (+ trend), fits you, the main posted budget, red-flag rate. Opens a subreddit.
- **`/insights/[subreddit]`**: all eleven insights as compact sections (numbers first, one plain sentence each; the hours as a small bar chart), an "Open r/x" link, and the user's 5 latest matches from this subreddit.
- **Match page:** one line under the post facts: "r/x: ~35 hiring posts a week · posted budgets USD/hour $15–35", only for insights past the threshold.
- **States:** locked (trial ended), building (fewer than 20 data points everywhere, e.g. first days), empty (no matches yet: points to Browse all), error.
- **Phone:** the list is one column; the tab bar keeps five items (Overview, Matches, Tracker, Insights, Profile) and Settings moves to the top bar's menu on phones.
- Look: the app's triage-desk style (`docs/ui/README.md`): dense rows, brand tokens, tabular numbers, orange only for strong signals; follow the anti-AI-slop checklist; the hours chart follows the dataviz skill.

## Not in this version

Converted currencies, cross-posting pairs, per-subreddit reply/response rates (Analytics §7.5, needs ~20 replies per subreddit), per-client history (§7.4), adding a subreddit to the catalogue (paid `user_subreddits`, later), alerts about insights.
