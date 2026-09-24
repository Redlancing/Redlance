# Redlance — Project Description (v1.1)

> Markdown transcription of `Redlance_Project_Description.pdf` (author: Abhinav Yadav, 24 Sep 2026, status: concept / pre-MVP).
> If the PDF is revised, update this file to match.

An AI assistant that finds freelance gigs on Reddit, matches them to a freelancer's profile, and drafts replies in the freelancer's own voice.

## 1. Executive summary

Every day, hundreds of clients post paid work on Reddit in subreddits such as r/forhire, r/hiring, r/DesignJobs and r/gameDevClassifieds. These posts are scattered across dozens of communities, move fast, and reward whoever replies first with a relevant, human-sounding message. Freelancers today either refresh these subreddits manually or miss the work entirely.

**Redlance** watches these subreddits continuously, filters out noise, scores each job against a freelancer's profile, alerts them within minutes, and drafts a short, specific reply that the freelancer edits and sends themselves. Over time it learns how each freelancer writes, tracks which replies turn into work, and builds pricing and client-history insights from the data it collects.

**Core promise:** "See the right Reddit gigs first, and reply in under two minutes with a message that sounds like you."

## 2. The problem

- **Scattered supply.** Freelance work on Reddit is spread over 15+ subreddits with different rules and formats. There is no single, freelancer-focused feed.
- **Speed decides outcomes.** The first few relevant replies usually get the client's attention. Freelancers who check manually are often late.
- **Noise and risk.** Many posts are "[For Hire]" ads from competitors, very low-budget, unpaid "test tasks", or outright scams.
- **Generic replies fail.** Redditors quickly ignore or downvote messages that read as copy-pasted or AI-generated. Writing a tailored reply for every post takes time.
- **No feedback loop.** Freelancers rarely know which subreddits, reply styles or response times actually win them work.

## 3. The solution

Redlance is a web app with a Telegram bot for instant alerts. The core loop:

| Step | What happens |
|---|---|
| 1. Collect | Poll subreddit RSS feeds every 2–3 minutes and store every new post. |
| 2. Understand | An LLM extracts structured fields: required skills, budget, paid/unpaid, remote/location, deadline. |
| 3. Match | Score each job 0–100 against each freelancer's profile, with a one-line reason. |
| 4. Alert | Send high-scoring jobs to the freelancer on Telegram within minutes. |
| 5. Draft | Generate a short comment reply and a DM version in the freelancer's voice. |
| 6. Send (human) | The freelancer edits and sends the reply from their own Reddit account. Redlance never auto-posts. |
| 7. Learn | Edits, outcomes and client behaviour feed back into better drafts, scores and insights. |

## 4. Target users

| Segment | Why they need it |
|---|---|
| Early-career freelancers (students, new graduates in India) | No Upwork reputation yet; Reddit gigs have no bidding fee and a lower barrier to entry. |
| Niche specialists (web dev, video editing, design, writing) | Want a steady flow of relevant gigs without scanning many subreddits every day. |
| Small agencies (V2) | Want to route the right gig to the right team member quickly. |

**Launch niche:** start with one category (e.g. web development or video editing) and 10–15 hiring subreddits. A narrow focus makes matching more accurate and marketing easier. Expand categories once the core loop works.

## 5. Data source strategy

Reddit charges for commercial use of its official Data API, and smaller tools have shut down after failing to secure a licence. Redlance therefore starts on public RSS feeds and moves to the official API once revenue can support it.

| Phase | Source | Notes |
|---|---|---|
| MVP | Public subreddit RSS feeds | Combine subreddits in one feed (e.g. `/r/forhire+hiring+DesignJobs/new/.rss`). Poll every 2–3 min with a proper User-Agent. Each feed returns roughly the latest 25 posts, so polling must be frequent enough not to miss any. |
| Growth | Official Reddit API (licensed) | Once revenue exists. Unlocks richer data such as comment counts, author account age and post edits. |
| V2+ | Other sources via adapters | HN "Who's Hiring", remote job boards with RSS, Telegram/Discord job channels, X "hiring" posts. |

**RSS limits to design around:** only title, body, author, link and timestamp are available; no comment counts or author reputation. Features that depend on those wait for the API phase.

**Design rule from day one:** every source goes through a *source adapter* that converts it into one common `JobPost` format. Matching, drafting and alerts never need to know where a post came from, so switching RSS → API, or adding new sources, is a contained change.

## 6. MVP features

| Feature | Description |
|---|---|
| Freelancer profile | Skills, niche, experience level, minimum rate, availability, portfolio links, and 2–3 samples of past messages for voice. Optional import from resume, GitHub or Behance. |
| Feed ingestion + parsing | Poll RSS, deduplicate, keep only [Hiring] posts and discard [For Hire]. LLM extracts skills, budget, paid/unpaid, remote/location and deadline. |
| Match score with reasons | 0–100 score plus a one-line explanation (e.g. "React + Supabase match; $400 is above your minimum"). User filters: minimum budget, blocked keywords, preferred subreddits. |
| Instant alerts | Telegram bot first (free, fast, popular in India); email or push later. |
| Reply drafting | Short, specific drafts that reference the client's problem and link the single most relevant portfolio piece. Two versions: comment and DM. Edit box plus "Open post" button. |
| Red-flag detection | Flags upfront fees, "move to Telegram/WhatsApp", crypto-only pay, unpaid test work, and budgets far too low for the scope. |
| Simple tracker | Saved → Replied → Client responded → Won/Lost. This data proves the product works and powers the V2 features. |

**Deliberately excluded:** auto-posting, bulk DMs, or anything that sends from the user's Reddit account without them clicking send. These get accounts shadowbanned and would destroy user trust.

**Store everything from day one:** every post, its extracted budget and skills, the author username and every outcome users report. Analytics, rate insights and client memory in V2 depend on this history; if collection starts only when V2 is built, those features launch empty.

## 7. V2 features

V2 begins once people are using the MVP regularly. These six features turn Redlance from an alert tool into a system that gets better for each user over time.

### 7.1 Voice learning — Effort: Low–Medium
- **What:** Drafts gradually sound like the freelancer, so they need fewer edits over time.
- **How:** Save every (AI draft, sent version) pair. After every 5–10 pairs, an LLM compares them and updates a short **style profile** of plain rules (e.g. "cuts greetings", "under ~50 words", "leads with one past project and a link", "ends with a question", "no emojis"). New drafts use the style profile plus the 2–3 most recent sent replies as examples. Also capture *regenerate* clicks, which of two variants the user picks, and what they delete. Users can view and edit their style rules. **Metric:** edit distance per draft should fall week over week.
- **Watch out:** Never turn a single edit into a rule. A pattern must repeat across several edits before it becomes a rule.

### 7.2 Follow-up reminders — Effort: Low
- **What:** Stops good leads from dying in silence.
- **How:** When a user marks a DM as sent, schedule a check-in 24–48 hours later. If no response is recorded, the bot nudges the user with a ready-made follow-up that adds something new (a relevant sample or a quick idea) rather than a plain "bump". Optionally re-check whether the post was deleted or edited to "[Filled]" and tell the user to stop.
- **Watch out:** Cap at 1–2 follow-ups per lead.

### 7.3 Rate insights — Effort: Medium
- **What:** Helps freelancers price well and spot posts that underpay.
- **How:** Normalise extracted budgets (fixed vs hourly, currency to USD/INR, rough scope: small task / project / ongoing). Group by skill category and scope; compute median and 25th–75th percentile ranges. Show in context: "pays less than 80% of similar logo-design posts", or while drafting, "similar projects typically pay $150–300; you could quote $250".
- **Watch out:** Many posts state no budget, and posted budgets skew low. Label it "posted budgets", not "market rate", and only show a range once a category has enough data points.

### 7.4 Repeat-client memory — Effort: Medium
- **What:** Adds context about who posted a job, based on their hiring history.
- **How:** Show signals like "this client posted 6 jobs in 3 months", "posted the same job 4 times", "usually budgets $200–400". Add crowd signals: "2 freelancers here were hired and paid by this client" or "1 user reported non-payment".
- **Watch out:** Fake/revenge reports — require several independent reports before showing a warning, show counts rather than labels like "scammer", and let reports expire. Scope strictly to hiring behaviour on job posts, never a person's wider Reddit activity.

### 7.5 Analytics — Effort: Medium–High
- **What:** Shows freelancers what actually gets them work.
- **How:** One-tap outcome collection: 48 h after a reply is sent, the bot asks "Did they respond?" with Yes / No / Got the gig. Measure response rate by subreddit, reply speed (post time vs reply time), comment vs DM, reply length, portfolio link included, and match-score bucket (also validates the matching model). Plain-language insights such as "replies sent within 15 minutes got 3× more responses". Later, anonymised cross-user benchmarks create a network effect.
- **Watch out:** Don't show an insight until at least ~20 data points support it.

### 7.6 More sources — Effort: Medium per source
- **What:** More jobs and less dependence on Reddit.
- **How:** Adapters that emit the common `JobPost` format. Candidates: HN "Who's Hiring" and "Freelancer? Seeking Freelancer?" threads (free official API); remote job boards with RSS (filter for contract work); Telegram/Discord job channels, incl. a "forward any job post to the bot" option; X "hiring" posts once revenue covers X's API cost.
- **Watch out:** Each source needs its own dedupe and spam rules; some channels allow bots only with admin permission.

### V2 build order

| Order | Feature | Why this position |
|---|---|---|
| 1 | Follow-up reminders + Voice learning | Cheap to build; users feel the improvement immediately. |
| 2 | Rate insights | Stored post data will be large enough by then. |
| 3 | Repeat-client memory | Needs a few months of posts and outcome reports. |
| 4 | Analytics | Needs the most outcome data to be trustworthy. |
| 5 | More sources | When Reddit alone no longer supplies enough jobs in the chosen niches. |

## 8. Architecture and tech stack

| Layer | Choice | Role |
|---|---|---|
| Frontend | Next.js (web) · React Native/Expo later | Profile setup, job feed, draft editor, tracker, analytics. |
| Backend / DB | Supabase (Postgres, Auth, Edge Functions) | Users, profiles, posts, matches, replies, outcomes. |
| Ingestion worker | Node or Python cron job (every 2–3 min) | Polls RSS, dedupes, runs source adapters. |
| AI layer | LLM API (extraction, scoring, drafting) | Structured extraction, match reasons, drafts, style profiles. |
| Matching | Embeddings (pgvector) + rule filters | Fast shortlist by similarity, then LLM re-score with reasons. |
| Alerts | Telegram Bot API | Instant job alerts, one-tap outcome reporting, follow-up nudges. |
| Payments | Razorpay (UPI, cards) | INR subscriptions for Indian freelancers. |

### Core data model

| Table | Key fields |
|---|---|
| users / profiles | id, skills[], niche, min_rate, portfolio_links[], voice_samples[], style_rules, filters |
| job_posts | id, source, external_id, url, title, body, author, posted_at, skills[], budget, budget_type, currency, is_paid, remote, red_flags[], embedding |
| matches | user_id, post_id, score, reason, alerted_at |
| replies | user_id, post_id, channel (comment/DM), ai_draft, sent_text, sent_at, variant_chosen |
| outcomes | reply_id, status (no response / responded / won / lost), reported_at, amount |
| client_reports | author, reporter_id, type (paid / non-payment / ghosted), created_at, expires_at |

## 9. Monetization

| Plan | Includes |
|---|---|
| Free | Alerts delayed by 30–60 minutes · a few AI drafts per day · basic tracker |
| Pro (monthly, INR, UPI) | Instant alerts · unlimited drafts · voice learning · follow-up reminders · rate insights |
| Agency (V2) | Multiple freelancer profiles · routing of gigs to the best-fit member · team analytics |

Because speed is the core value on Reddit, the alert delay on the free tier is itself the reason to upgrade.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Reddit blocks or limits RSS access | Poll politely with a clear User-Agent; source adapters make switching to the licensed API a contained change; add non-Reddit sources early. |
| Commercial-use restrictions on Reddit data | Stay small and non-commercial while validating; budget for the official API before scaling paid plans. |
| Users' accounts get shadowbanned | No auto-posting or bulk DMs; human sends every reply; warn about subreddit rules and repetitive messages. |
| Drafts sound AI-generated | Short drafts grounded in the post and one portfolio piece; voice learning; edit-distance tracking as a quality metric. |
| Scams reaching users | Red-flag detection plus community reports on clients. |
| Not enough jobs in a niche | Choose the launch niche by measuring post volume first; add more sources in V2. |
| Trademark conflict over "Reddit" | Never use "Reddit" in the product name, domain or logo, and never use Reddit's alien mascot. Use "Reddit" only descriptively in page text ("find freelance jobs on Reddit") and never imply an official connection. |

## 11. Roadmap and success metrics

| Phase | Timeline | Goal | Success signal |
|---|---|---|---|
| 0. Validate | Weeks 1–2 | Telegram bot for one niche, 10–15 subreddits; used by the founder and ~20 friends | Users open alerts daily; at least a few gigs won |
| 1. MVP | Weeks 3–8 | Web app with profile, scoring, drafts, red flags and tracker | 100 active users; >30% of alerts get a draft |
| 2. Monetize | Months 3–4 | Pro plan on Razorpay; follow-ups and voice learning | First paying users; falling edit distance |
| 3. V2 | Months 4–8 | Rate insights, client memory, analytics, new sources; licensed Reddit API | Rising response and win rates per user |

**North-star metric:** gigs won per active user per month. Supporting metrics: alert-to-reply time, response rate on sent replies, draft edit distance, weekly retention.

## 12. Name and discoverability (SEO, GEO, AEO)

**Name: Redlance** — **Red** (Reddit) + **lance** (freelance). Signals both what the product works with and who it's for, without using Reddit's trademark (same pattern as Redreach, an existing Reddit lead-gen tool). Still needs a domain check (.com / .app / .ai), matching social handles, and a trademark search on IP India (class 42). **Backup:** RedGigs. **Avoid:** RedHire (used by RedHire AI and AirAsia's hiring site).

**One-line description, used word for word everywhere** (homepage, meta description, Product Hunt, LinkedIn, GitHub, directories, social bios):

> Redlance is an AI tool that finds freelance jobs on Reddit, matches them to your skills, and drafts replies in your voice.

**Key principle: pages rank, not names.** A product name alone will never rank for "reddit". Winnable searches are longer phrases such as "freelance jobs on reddit" or "reddit web developer gigs", won by pages whose title, heading, URL and content match the search. Redreach ranks this way: a separate feature page per keyword, comparison and alternatives pages, a free guide, and a directory reviewing competing tools.

| Channel | How it works | What Redlance does |
|---|---|---|
| SEO (Google) | Ranks pages on relevance (title, heading, URL, content), authority (links from trusted sites) and quality (people find the answer and stay). | One page per search: `/reddit-freelance-jobs`, `/reddit-web-developer-gigs`, `/reddit-video-editing-jobs`, `/best-subreddits-for-freelancers`. A live public feed of the latest hiring posts (short snippet + link back only). Guides: "How to reply to r/forhire posts", "Reddit freelance scams to avoid". Comparison pages: "Redlance vs Upwork", "Best tools to find freelance work on Reddit". Backlinks from Product Hunt, AI-tool directories, Indie Hackers, freelancer blogs. |
| GEO (ChatGPT, Perplexity, Gemini, AI Overviews) | AI engines search, summarise and cite. They favour products mentioned consistently across many sites, and content with clear facts and numbers. | Repeat the one-line description everywhere. Publish original data from stored posts (e.g. "We analysed 10,000 Reddit hiring posts: what logo designers actually get paid"). Get listed in "best tools" roundups. Take part genuinely in r/freelance and r/forhire. |
| AEO (featured snippets, "People also ask", voice) | Answer engines pull one direct, self-contained answer to a question. | Question headings ("How do I find freelance work on Reddit?") followed by a 40–60 word direct answer, then detail. FAQ and HowTo schema (structured data). Target the exact questions in Google's "People also ask" box. |

**Timing:** a new domain typically needs 3–6 months of steady content before it ranks well. Content pages and the data blog start alongside the MVP (Phase 0–1), not after launch. **Metrics:** organic sign-ups, rankings for target phrases, and how often AI engines mention Redlance when asked how to find freelance work on Reddit.
