# Hiring subreddits: research and live check (2026-09-30, second pass 2026-10-01)

What this is: every subreddit we found where clients post paid freelance work, checked live against Reddit on 2026-09-30. It replaces the 16-subreddit seed list in `packages/core/src/subreddits.ts` (that file changes in the ingestion build, after review). Raw numbers: `data/subreddits-measured-2026-09-30.json` and `data/subreddit-discovery-2026-09-30.json`.

## How it was found

1. **Web research** by five agents, one per group of job types (development and data; games, 3D and art; design, photo and video; audio, writing and marketing; general, remote and regional). Sources: GummySearch subreddit pages (sizes, flairs, related subreddits), blog lists, a Reddit mirror for rules. 147 candidates.
2. **Discovery from real posts:** 40 Reddit title searches (`title:hiring`, `title:task`, `title:paid`, `title:hiring video editor`, …) over the past month, keeping only titles that start with a hiring tag. Hiring posts turned up in 371 subreddits; the 76 new ones with 3+ hits were added.
3. **Live check** of all 223 over RSS: posts per day, share of titles tagged hiring vs for hire, and date of the newest post.

## Summary

| Group | Subreddits | Posts/day |
|---|---|---|
| Poll: core freelance boards | 144 | 2,018 + r/slavelabour (not measured) |
| Poll: mostly freelancers advertising, clients rare | 14 | 285 |
| Poll: regional job boards | 25 | 776 |
| Your call | 5 | 220 |
| Exclude | 12 | 2,197 |
| Dead (no post in 30+ days, or under 0.3 a day) | 19 | — |
| Gone (404: banned, private or renamed) | 4 | — |

Key findings:

- **Volume.** About 3,100 posts a day across the polled groups (not counting r/slavelabour), with about 400 a day tagged as hiring in the title. The real hiring count is higher, because many subreddits mark paid work with flair only.
- **RSS has no flair** (checked). Where paid vs free or client vs freelancer is set by flair (r/PhotoshopRequest, r/estoration, r/dndcommissions "LFC", r/VirtualAssistantPH, r/robloxgamedev "Looking For Devs (Paid)", r/VideoEditingRequests), the analyser has to decide from the title and body. In the tables below, a 0% hiring tag on a busy request board usually means flair-only, not no hiring.
- **Hiring tags vary:** `[Hiring]`, `[HIRING]`, `[Task]`, `[Paid]`, `[BUYING]`, `[Commission]`, Patron, Client, LFC, SEEKING, `PAID - <role>`, "Looking For Paid Services", "Drawing Request (Paid)". For-hire tags: `[For Hire]`, `[Hire Me]`, `[Offer]`, `[Selling]`, "Commissions open". Many posts have no tag at all.
- **Filter out:** RevShare, Hobby and Free posts (r/INAT, r/ComicBookCollabs, r/DrawForMe, r/CreatorServices), commission-only "clipper" and closer jobs, gifted-only UGC deals, and full-time salaried roles on the job boards. The analyser should extract employment type (freelance / contract / part-time / full-time) and pay type (paid / commission-only / revshare / free).
- **Hiring in comments only.** These subreddits allow hiring only in a pinned megathread, not in posts, so post ingestion won't see it: r/developersIndia (monthly "Who's hiring"), r/graphic_design (Job Board), r/golang, r/rust, r/sales. Catching them would take a comment feed per thread (later).
- **Rate limit.** Signed-out RSS allows 1 request a minute per IP (fixed windows, headers `x-ratelimit-*`). A request sent seconds after a window reset still got 429s, so the rule is **at least 65 s between requests**. Each request returns at most 100 posts (`limit=100`; more is ignored). Combined feeds (`/r/a+b+c/new/.rss`) and paging (`after=t3_…`) both work.
- **Data-centre IPs.** Works from a Google Cloud IP (Cloud Shell, 2026-09-30): single, combined, search and r/slavelabour all returned 200 with 100 posts. **AWS is not tested yet**: run the same script in AWS CloudShell before deploying the worker.
- **Site-wide search RSS works** (`/search.rss?q=title:hiring&sort=new`) and finds hiring posts in subreddits not on this list. Worth one poll in every ~6 as a catch-all.

Columns: **posts/day** (all posts), **hiring %** and **for hire %** (share of titles with those tags; flair-only subreddits read low), **convention** (how clients mark posts, from research).

## Poll: core freelance boards

### Games, 3D & animation

| Subreddit | Posts/day | Hiring % | For hire % | Convention |
|---|---|---|---|---|
| r/robloxgamedev | 59.9 | 3% | 0% | flair "Looking For Devs (Paid)" |
| r/RobloxDevelopers | 40.5 | 4% | 4% | Advertising flair |
| r/gameDevClassifieds | 28.2 | 6% | 75% | flair PAID - <role> |
| r/robloxstudio | 26.4 | 3% | 3% | — |
| r/INAT | 24.7 | 0% | 50% | [Paid] only; drop RevShare/Hobby |
| r/gameDevJobs | 22.9 | 0% | 100% | paid only |
| r/Animators | 10.0 | 14% | 0% | Hiring flair |
| r/tabletopgamedesign | 9.3 | 8% | 15% | Hiring Artist (Paid) |
| r/mcstaff | 7.9 | 9% | 18% | paid dev/builder roles |
| r/3Dprintmything | 7.3 | 0% | 0% | flair SEEKING |
| r/robloxanimation | 7.3 | 14% | 0% | — |
| r/2DAnimation | 6.4 | 0% | 0% | Hiring flair |
| r/3danimation | 4.7 | 10% | 0% | — |
| r/AnimationJobs | 2.9 | 50% | 0% | [HIRING] |
| r/indiananimation | 1.8 | 29% | 0% | — |
| r/vndevs | 1.5 | 3% | 8% | flair Recruiting |

### Development

| Subreddit | Posts/day | Hiring % | For hire % | Convention |
|---|---|---|---|---|
| r/AiAutomations | 35.8 | 3% | 0% | [Hiring] $ |
| r/DeveloperJobs | 20.4 | 7% | 37% | job listings |
| r/indiandevelopers | 13.8 | 4% | 0% | — |
| r/devopsjobs | 12.1 | 20% | 7% | mostly FT |
| r/Programmers_forhire | 12.1 | 0% | 54% | mixed |
| r/wordpressjobs | 9.4 | 0% | 50% | — |
| r/CodingJobs | 6.8 | 11% | 44% | mixed |
| r/WebDeveloperJobs | 6.8 | 0% | 67% | HIRING flair |
| r/PythonJobs | 6.2 | 6% | 67% | mixed |
| r/techjobs | 6.2 | 72% | 22% | Contract flair |
| r/FreelanceProgramming | 5.9 | 0% | 53% | mixed |
| r/webflow | 4.6 | 0% | 0% | Need project help |
| r/n8n | 4.5 | 0% | 0% | Now Hiring flair |
| r/WebDevJobs | 4.5 | 0% | 17% | paid only |
| r/remotepython | 3.4 | 0% | 80% | jobs |
| r/webscraping | 2.7 | 2% | 0% | Hiring flair |
| r/dev | 2.6 | 0% | 1% | hiring topic |
| r/Discord_Bots | 1.8 | 3% | 9% | flair "Bot Request [Paid]" |
| r/sysadminjobs | 1.6 | 17% | 17% | mostly FT |
| r/developer | 1.3 | 0% | 0% | job posts welcome |
| r/CryptoJobsList | 0.7 | 100% | 0% | [HIRING] |
| r/Jobs4Crypto | 0.7 | 9% | 44% | hire/for hire |
| r/remotejs | 0.7 | 50% | 0% | hiring |
| r/solidity | 0.5 | 0% | 0% | hiring posts |
| r/Bubbleio | 0.3 | 0% | 0% | Help Wanted |

### Data

| Subreddit | Posts/day | Hiring % | For hire % | Convention |
|---|---|---|---|---|
| r/mljobs | 10.9 | 5% | 11% | — |
| r/Dataentry_Offers | 7.9 | 0% | 55% | mostly for hire |
| r/MachineLearningJobs | 7.9 | 14% | 0% | mostly FT |
| r/dataengineeringjobs | 7.8 | 7% | 0% | mostly FT |
| r/aidatatrainingjobs | 6.3 | 27% | 0% | — |
| r/DataScienceJobs | 4.3 | 17% | 8% | mixed |
| r/BigDataJobs | 0.9 | 12% | 69% | [HIRING] |
| r/AIJobs | 0.4 | 100% | 0% | scam-prone |

### General gig boards

| Subreddit | Posts/day | Hiring % | For hire % | Convention |
|---|---|---|---|---|
| r/slavelabour | not measured | — | — | [TASK]=hiring [OFFER]=for hire. From the laptop the check got 429s three times; the Google Cloud test returned 100 posts, so the subreddit works. Research: 491k members, very active |
| r/B2BForHire | 69.9 | 29% | 39% | [Hiring]/[For Hire] |
| r/ForHireFreelance | 33.7 | 15% | 58% | flair only |
| r/forhire | 33.0 | 14% | 86% | [Hiring]/[For Hire] title |
| r/sidehustleIndia | 30.8 | 9% | 16% | flair only |
| r/FreelanceIndia | 23.2 | 32% | 18% | flair only |
| r/hiring | 20.4 | 21% | 78% | [HIRING]/[FOR HIRE] |
| r/developers_hire | 16.8 | 14% | 33% | — |
| r/DoneDirtCheap | 11.6 | 0% | 76% | TASK/OFFER |
| r/freelances_forhire | 10.9 | 16% | 53% | — |
| r/workonlineindia | 8.6 | 47% | 20% | — |
| r/RedditJobBoard | 7.1 | 36% | 42% | curated |
| r/sidehustlesindia | 3.0 | 25% | 25% | — |
| r/Jobs4Bitcoins | 2.7 | 25% | 75% | [Hiring]/[For Hire]; crypto pay |
| r/onlinehiringtips | 2.5 | 20% | 0% | — |
| r/forhire2 | 2.4 | 14% | 86% | [HIRING]/[FOR HIRE] |
| r/hiring_recruiting | 2.3 | 31% | 15% | — |
| r/we_hiring | 0.9 | 100% | 0% | — |
| r/algerianfreelancers | 0.3 | 100% | 0% | — |

### Art & illustration

| Subreddit | Posts/day | Hiring % | For hire % | Convention |
|---|---|---|---|---|
| r/artcommissions | 78.6 | 8% | 89% | [Hiring] + Patron flair |
| r/artrequest | 64.1 | 0% | 27% | — |
| r/Artistsforhire | 63.7 | 3% | 97% | [BUYING]/[SELLING] |
| r/dndcommissions | 58.9 | 0% | 84% | flair LFC |
| r/ArtSale | 53.7 | 41% | 44% | mostly for hire |
| r/HungryArtists | 53.1 | 24% | 76% | [Hiring]/[For Hire]; $30 min |
| r/artcommission | 48.7 | 9% | 81% | mostly for hire |
| r/artcommissionsph | 25.5 | 11% | 67% | — |
| r/artistforhire | 24.8 | 10% | 52% | mixed |
| r/DrawForMe | 23.8 | 2% | 4% | flair "Paid Request" |
| r/ComicBookCollabs | 22.4 | 0% | 63% | flair "Looking for Artist - Paid" |
| r/mangaartistforhire | 15.0 | 3% | 59% | — |
| r/AnimeCommission | 8.2 | 0% | 17% | For Hire/Hiring |
| r/DrawMyTattoo | 4.6 | 0% | 0% | flair "Drawing Request (Paid)" |
| r/VtuberCommission | 1.9 | 2% | 52% | mixed |
| r/brushforhire | 1.8 | 0% | 0% | clients hire mini painters |
| r/IllustratorsForHire | 1.2 | 0% | 0% | [HIRING] |

### Design

| Subreddit | Posts/day | Hiring % | For hire % | Convention |
|---|---|---|---|---|
| r/Thumbnails | 18.8 | 0% | 9% | HIRING: titles |
| r/GraphicDesignServices | 17.9 | 9% | 55% | [Hiring]/[For Hire] |
| r/GraphicDesignJobs | 17.0 | 38% | 50% | [HIRING]/[FOR HIRE] |
| r/DesignJobs | 10.9 | 40% | 60% | [Hiring]/[For Hire]; $20/h floor |
| r/BookCovers | 10.6 | 0% | 33% | [HIRING] |
| r/YouTubeThumbnailHub | 9.8 | 0% | 0% | flair Hiring |
| r/graphicdesignph | 3.8 | 13% | 0% | — |
| r/bookdesign | 1.4 | 33% | 33% | — |

### Marketing & UGC

| Subreddit | Posts/day | Hiring % | For hire % | Convention |
|---|---|---|---|---|
| r/ugc_forhire | 25.6 | 42% | 8% | — |
| r/UGCcreators | 21.4 | 0% | 0% | (PAID) brand posts |
| r/ugcfortech | 20.8 | 40% | 0% | — |
| r/brandscreators | 13.4 | 0% | 7% | — |
| r/MarketingJobs | 12.3 | 16% | 18% | hiring |
| r/seojobs | 11.4 | 7% | 0% | job listings |
| r/UGCconnect | 10.5 | 31% | 0% | flair Paid gig |
| r/ugcs | 6.9 | 25% | 0% | — |
| r/ugcuniversity | 6.4 | 62% | 0% | — |
| r/techugc | 6.2 | 50% | 0% | — |
| r/ugcsidehustle | 6.0 | 38% | 0% | — |
| r/leadgenmarketplace | 4.5 | 33% | 17% | — |

### Writing

| Subreddit | Posts/day | Hiring % | For hire % | Convention |
|---|---|---|---|---|
| r/ghostwriterscommunity | 9.4 | 50% | 0% | — |
| r/ContentWritingJobs | 6.1 | 0% | 24% | hiring |
| r/HireaWriter | 2.8 | 12% | 69% | Hiring/Hire Me flair |
| r/HireABookEditor | 1.4 | 0% | 60% | client posts |

### Video

| Subreddit | Posts/day | Hiring % | For hire % | Convention |
|---|---|---|---|---|
| r/HireAnEditor | 47.7 | 24% | 32% | [Hiring]/[For Hire] |
| r/VideoEditors_forhire | 35.0 | 33% | 37% | [Hiring]/[For Hire] |
| r/CreatorServices | 34.4 | 12% | 38% | flair "Looking For Paid Services" |
| r/YouTubeEditorsForHire | 31.4 | 7% | 33% | [Hiring]/[For Hire] |
| r/videoeditingindia | 27.5 | 25% | 0% | — |
| r/FindVideoEditors | 15.1 | 62% | 0% | [HIRING]/[Paid] |
| r/VideoEditingJobs | 15.1 | 31% | 0% | [HIRING] |
| r/videoeditors_hiring | 14.6 | 14% | 29% | — |
| r/YouTubeEditorForHire | 13.1 | 6% | 44% | [Hiring]/[For Hire] |
| r/videoeditors | 11.2 | 7% | 0% | — |
| r/VideoEditingRequests | 4.7 | 50% | 0% | flair "[HIRING] Paid" vs Free |
| r/weddingvideography | 4.1 | 0% | 0% | [Hiring] flair |
| r/VideoEditor_forhire | 2.3 | 50% | 0% | [Hiring]/[For Hire] |
| r/EditingVideo | 1.6 | 50% | 0% | untagged hiring |
| r/videoeditingconnect | 1.0 | 100% | 0% | — |

### Photo

| Subreddit | Posts/day | Hiring % | For hire % | Convention |
|---|---|---|---|---|
| r/PhotoshopRequest | 65.8 | 0% | 0% | flair Paid vs Free |
| r/PhotographyJobs | 7.1 | 2% | 4% | local shoots |
| r/estoration | 5.6 | 0% | 4% | flair "Paid Restoration Request" |
| r/PhotoshopRequests | 3.1 | 2% | 0% | $ flairs |
| r/picrequests | 1.7 | 2% | 0% | flair "Request a PRO" |

### Audio

| Subreddit | Posts/day | Hiring % | For hire % | Convention |
|---|---|---|---|---|
| r/VoiceActing | 10.5 | 13% | 2% | PAID flair |
| r/VoiceWork | 1.9 | 18% | 27% | [Hiring] flairs |
| r/voiceover | 1.5 | 0% | 0% | — |
| r/recordthis | 1.2 | 86% | 0% | [PAID] |
| r/mixingmastering | 1.0 | 17% | 0% | Service Request flair |

### Admin & virtual assistance

| Subreddit | Posts/day | Hiring % | For hire % | Convention |
|---|---|---|---|---|
| r/virtualassistantphil | 29.9 | 14% | 14% | — |
| r/VirtualAssistant | 14.8 | 39% | 61% | [HIRING] titles |
| r/onlineservicesPH | 10.7 | 8% | 36% | mostly for hire |
| r/vajobsph | 10.4 | 15% | 23% | — |
| r/RemoteJobs | 10.1 | 33% | 0% | mostly FT |
| r/WFHJobs | 10.1 | 11% | 0% | scam-prone |
| r/VirtualAssistantPH | 8.7 | 12% | 56% | flair only (CLIENT vs VA) |
| r/remoteworks | 4.5 | 0% | 0% | scam-prone |
| r/remoteworking | 1.1 | 0% | 0% | flair [Hiring Contractor (1099)] |
| r/phwork | 0.5 | 100% | 0% | — |

## Poll: mostly freelancers advertising, clients rare

These are cheap to include (the LLM drops for-hire posts), but they won't bring many jobs.

| Subreddit | Posts/day | Hiring % | For hire % | Convention |
|---|---|---|---|---|
| r/commissions | 54.8 | 0% | 100% | mostly for hire |
| r/indianstartups | 48.0 | 3% | 3% | hiring flair |
| r/StartUpIndia | 40.0 | 0% | 0% | hiring flair |
| r/starvingartists | 38.1 | 4% | 96% | mostly for hire |
| r/hiringpakistan | 33.9 | 0% | 0% | — |
| r/artstore | 15.2 | 0% | 64% | [Commission] |
| r/HireanArtistHub | 12.4 | 0% | 89% | mostly for hire |
| r/indianfilmmakers | 10.5 | 2% | 0% | — |
| r/ecommerceindia | 10.3 | 5% | 0% | — |
| r/Live2D | 9.1 | 0% | 0% | mostly for hire |
| r/commissionart | 6.9 | 0% | 100% | mostly for hire |
| r/freelancewriting | 5.4 | 0% | 0% | — |
| r/fantasyartists | 0.5 | 1% | 74% | flair Client |
| r/RobloxArt | 0.3 | 0% | 6% | Request flair |

## Poll: regional job boards

Mostly local employment (US, UK, India, Philippines, Middle East, Canada, Singapore, Indonesia, Nepal), with some remote, part-time and VA gigs. Poll them, but the analyser should tag full-time roles so the feed can hide them by default.

| Subreddit | Posts/day | Hiring % | For hire % | Convention |
|---|---|---|---|---|
| r/menajobs | 75.6 | 23% | 0% | — |
| r/technepal | 68.0 | 8% | 0% | — |
| r/jobph | 67.8 | 25% | 25% | — |
| r/Indiajobs | 65.6 | 22% | 2% | mostly FT |
| r/philippinesjobs | 65.3 | 5% | 0% | — |
| r/jobsphilippines | 61.8 | 17% | 0% | — |
| r/workingstudentph | 54.1 | 6% | 12% | — |
| r/hiringphilippinesph | 51.2 | 21% | 4% | — |
| r/singaporejobs | 51.0 | 11% | 0% | — |
| r/classifiedsph | 43.5 | 5% | 7% | — |
| r/bangalorejob | 35.7 | 8% | 8% | — |
| r/uaejobseekers | 24.4 | 6% | 0% | — |
| r/indiafreshers | 22.6 | 2% | 4% | — |
| r/phjobs | 19.2 | 22% | 0% | — |
| r/NYCjobs | 15.7 | 14% | 3% | [Hiring]/[For Hire] |
| r/jobphilippines | 9.4 | 0% | 0% | — |
| r/recruitinghiringph | 8.4 | 29% | 6% | — |
| r/vancouverjobs | 7.0 | 0% | 0% | — |
| r/karir | 6.7 | 22% | 0% | — |
| r/torontoJobs | 6.4 | 0% | 0% | FT |
| r/careerstartindia | 4.9 | 16% | 0% | — |
| r/jobhuntph | 4.4 | 18% | 0% | — |
| r/HiringPH | 3.6 | 18% | 6% | mostly employment |
| r/trianglejobs | 1.8 | 100% | 0% | — |
| r/DubaiJobs | 1.5 | 0% | 0% | mixed |

## Your call

| Subreddit | Posts/day | Hiring % | Why it needs a decision |
|---|---|---|---|
| r/chatterjobs | 85.9 | 24% | "OF chatter" jobs: chatting as an OnlyFans creator (adult industry) |
| r/FurryCommissions | 49.6 | 3% | furry art commissions; many posts NSFW |
| r/cofounderhunt | 47.0 | 5% | mostly equity-only cofounder searches; only "Paid Role" posts are gigs |
| r/highticket_sales | 20.4 | 26% | sales closers, mostly commission-only |
| r/appointmentsetter | 16.6 | 64% | appointment setters, often commission-only (no base pay) |

## Exclude

| Subreddit | Posts/day | Reason |
|---|---|---|
| r/jobboardsearch | 1593.8 | bot reposting full-time job-board listings (1,600/day; would drown every shared feed) |
| r/bpoinph | 199.4 | call-centre employment, 3% hiring |
| r/minecraftserver | 155.4 | Minecraft server ads, no hiring |
| r/delhimarketplace | 138.9 | buy/sell marketplace |
| r/softwareengineerjobs | 31.3 | full-time jobs and career advice |
| r/remoteaccountingroles | 27.5 | full-time salaried jobs reposted from job boards |
| r/remotelegaljobs | 23.5 | full-time salaried jobs reposted from job boards |
| r/daily_techjobs_india | 18.4 | full-time tech jobs, seekers |
| r/jobminglrjobs | 3.9 | daily digest of full-time openings |
| r/remotivejobs | 1.8 | full-time reposts from remotive.com |
| r/christiantechjobs | 1.6 | full-time reposts |
| r/christianjobs | 1.1 | full-time reposts |

## Dead or nearly dead

| Subreddit | Posts/day | Newest post |
|---|---|---|
| r/railsjobs | 0.0 | 2022-01-03 |
| r/MarketersForHire | 0.0 | 2022-02-23 |
| r/virtualassistants | 0.1 | 2024-06-12 |
| r/Producersandartists | 0.1 | 2024-07-13 |
| r/TranscriptionJobs | 0.0 | 2024-09-05 |
| r/FreelanceEditors | 0.1 | 2025-01-06 |
| r/bookcoverdesign | 0.1 | 2025-12-12 |
| r/sidehustlePH | 0.4 | 2026-05-13 |
| r/podcastediting | 0.0 | 2026-05-15 |
| r/likeremote | 0.1 | 2026-07-21 |
| r/hireaprogrammer | 0.0 | 2026-07-21 |
| r/hireanartist | 2.0 | 2026-08-15 |
| r/writersforhire | 0.2 | 2026-09-03 |
| r/gigs_hiring | 0.0 | 2026-09-05 |
| r/logoforhire | 0.0 | 2026-09-14 |
| r/ContentWriter_forhire | 0.1 | 2026-09-25 |
| r/colorizationrequests | 0.2 | 2026-09-26 |
| r/vaphilippines | 0.1 | 2026-09-29 |
| r/jobbit | 0.1 | 2026-09-30 |

## Gone

| Subreddit | Result |
|---|---|
| r/freelance_forhire | http 404 |
| r/IndiaJobsOpenings | http 404 |
| r/SEO_Marketing_Offers | http 404 |
| r/UGCForBrands | http 404 |

## Second pass (2026-10-01)

The first list came from research and one month of post searches, so it could miss boards nobody writes about. The second pass looked three more ways, then checked every candidate live the same way. Raw numbers: `data/subreddits-added.json`; decisions are applied in `data/catalogue.json` and `packages/core/src/subreddit-catalogue.ts`.

1. **Reddit's subreddit search:** 72 queries (`hire`, `commission`, `gigs`, `ugc`, `voice actor`, `freelance philippines`, `vagas`, `empleo freelance`, …) returned 3,635 subreddits, of which 962 mention hiring words. They were triaged by hand: dropped fan, game, adult and discussion subreddits, kept 158.
2. **Post search over a year:** 30 queries for niche roles (tattoo, VTuber, pixel art, FiveM, Godot, Discord bot, Excel, cold caller…) added 65 subreddits with 2+ hiring-tagged posts.
3. **Related subreddits** of our boards on GummySearch: 512 pages. Mostly discussion subreddits; the job boards among them were folded into the 158.

**Result of the live check (223 candidates):**
- 22 added as core boards
- 20 added as regional job boards
- 10 added as "mostly freelancers advertising"
- 46 excluded
- 125 dead or gone

**Most "for hire" sounding names were dead.** r/workforhire, r/programmersforhire, r/forhireuk, r/hireacoder, r/vtuberartcommissions and about 120 more had no post in 30 days, which is why every candidate was checked live.

**Diminishing returns.** The additions carry about 2,000 posts a day but only about 50 a day tagged hiring (the first list carries about 400). The big boards were already found; what's left is long tail, mostly regional.

### Added: core boards

| Subreddit | Posts/day | Hiring % | For hire % |
|---|---|---|---|
| r/makemoneyindia | 45.4 | 14% | 0% |
| r/techsalesjobs | 19.3 | 11% | 0% |
| r/sidehustlepaglu | 9.6 | 19% | 4% |
| r/3dmodels | 8.5 | 9% | 4% |
| r/devsforhire | 8.1 | 13% | 11% |
| r/designindia | 7.7 | 23% | 0% |
| r/gamedevelopersofindia | 7.7 | 8% | 8% |
| r/hireforgigs | 6.9 | 16% | 59% |
| r/recruitmenthub | 6.7 | 17% | 21% |
| r/freelancer_hire | 5.4 | 0% | 57% |
| r/javascriptjobs | 4.6 | 11% | 67% |
| r/nophoneremotejobs | 4.3 | 22% | 0% |
| r/3drequests | 4.0 | 17% | 4% |
| r/dotnetjobs | 3.1 | 0% | 44% |
| r/remotebackendjobs | 2.5 | 0% | 100% |
| r/scrapingtheweb | 2.2 | 17% | 0% |
| r/remoteprogrammingjobs | 2.1 | 0% | 0% |
| r/artrequests | 0.7 | 1% | 0% |
| r/naijaremote | 0.7 | 9% | 9% |
| r/vettedcutseditors | 0.4 | 83% | 0% |
| r/minecraftdev | 0.4 | 3% | 4% |
| r/ineedalogo | 0.3 | 2% | 82% |

### Added: regional job boards

| Subreddit | Posts/day | Hiring % | For hire % |
|---|---|---|---|
| r/freshertechjobsindia | 29.5 | 10% | 0% |
| r/jobsindubaiuae | 14.1 | 0% | 12% |
| r/firstjobindia | 12.9 | 18% | 0% |
| r/chennaihiring | 9.2 | 12% | 0% |
| r/sales_india | 8.9 | 20% | 7% |
| r/keralacareers | 7.2 | 25% | 0% |
| r/startupindiajobs | 7.1 | 14% | 4% |
| r/abudhabijobs | 7.1 | 0% | 0% |
| r/saudiarabiajobs | 6.8 | 2% | 0% |
| r/colombiaempleo | 6.1 | 12% | 0% |
| r/jobsfordevelopers | 6.0 | 0% | 0% |
| r/chicagojobs | 5.5 | 16% | 0% |
| r/austinjobs | 4.5 | 20% | 4% |
| r/pakistantechjobs | 3.8 | 0% | 20% |
| r/mumbaijobsopenings | 3.7 | 25% | 0% |
| r/atljobs | 2.6 | 29% | 0% |
| r/denverjobs | 2.0 | 9% | 5% |
| r/remotegamejobs | 1.8 | 0% | 0% |
| r/sfbayjobs | 1.2 | 57% | 2% |
| r/seajobs | 0.8 | 0% | 0% |

### Added: mostly freelancers advertising

| Subreddit | Posts/day | Hiring % | For hire % |
|---|---|---|---|
| r/tabletopartists | 26.5 | 0% | 89% |
| r/robloxcommissions | 20.3 | 0% | 4% |
| r/indiansidehustle | 9.2 | 0% | 0% |
| r/devjobs | 9.0 | 0% | 20% |
| r/b2bsales | 8.4 | 0% | 0% |
| r/fullstackdevelopers | 7.2 | 0% | 25% |
| r/hireawritercommunity | 6.5 | 0% | 100% |
| r/pakfreelancers | 5.1 | 1% | 5% |
| r/mcbuildersforhire | 0.8 | 7% | 2% |
| r/designers_forhire | 0.5 | 6% | 71% |

### Excluded

| Subreddit | Posts/day | Reason |
|---|---|---|
| r/nepalsocial | 577.8 | city/social chat |
| r/productdesignjobs | 242.7 | bot reposting ~240 full-time listings a day |
| r/hyderabad | 130.3 | city sub; 4% hiring of 130 posts a day |
| r/phclassifieds | 75.6 | buy/sell classifieds |
| r/dubaiclassifieds | 57.0 | buy/sell classifieds |
| r/nagpur | 56.0 | city sub |
| r/counterstrike2 | 49.3 | game discussion |
| r/chennaicity | 43.9 | city sub |
| r/sidehustlegold | 42.2 | side-hustle discussion |
| r/empleos_ar | 41.9 | 3% hiring of 42 posts a day |
| r/bangalorestartups | 35.1 | startup discussion |
| r/dhaka | 27.4 | city sub |
| r/qatarcareers | 16.3 | job seekers |
| r/addu | 16.2 | university sub |
| r/interiordesignsindia | 16.2 | discussion |
| r/algeria | 13.0 | country sub |
| r/amdavadclassifieds | 12.4 | classifieds |
| r/fusion360 | 12.0 | software help |
| r/computervision | 11.6 | research discussion |
| r/punejobs | 10.9 | 0% hiring |
| r/3dprintindia | 10.8 | hobby discussion |
| r/hyderabadstartups | 10.8 | startup discussion |
| r/informatikkarriere | 10.0 | career discussion |
| r/productmanagementjobs | 7.8 | bot reposting ~240 full-time listings a day |
| r/pakistanidevs | 7.8 | discussion |
| r/ai_ugc_marketing | 7.5 | discussion |
| r/rishikesh | 7.3 | city sub |
| r/webtooncanvas | 6.5 | discussion |
| r/voiceautomationai | 6.2 | product chat |
| r/algeriawork | 5.4 | discussion |
| r/indiacontentcreators | 5.1 | creator chat |
| r/canadajobs | 4.8 | discussion |
| r/indian_architects | 4.8 | discussion |
| r/javaprogramming | 4.7 | programming help |
| r/cybersecurityjobs | 3.3 | career discussion |
| r/kurnool_city | 3.1 | city sub |
| r/freelancing | 3.0 | discussion |
| r/technicalwriting | 2.9 | discussion |
| r/ahmedabadclassifieds | 2.7 | classifieds |
| r/networkingjobs | 2.6 | career discussion |
| r/indiajobseeker | 1.9 | job seekers |
| r/captureone | 1.5 | software |
| r/chinajobs | 1.0 | job seekers |
| r/indoreclassifieds | 0.9 | classifieds |
| r/jobsindata | 0.8 | digest of full-time roles |
| r/remotefrontendjobs | 0.3 | discussion |

### Dead or gone

r/3designrequests, r/3dpaidrequests, r/3dprintmythings, r/ai_writing_jobs, r/aitraininggigs, r/animatorsforhire, r/appcommissions, r/art4hire, r/artists_forhire, r/baltimoreforhire, r/bountygigs, r/contractjobs, r/cryptodevjobs, r/cryptofreelance, r/cryptogigs, r/customart, r/cyberhire, r/datajoblist, r/datavizrequests, r/designrequests, r/designwork, r/developer_for_hire, r/djangojobs, r/dmforhire, r/dnwork, r/editorhiring, r/emotecommissions, r/esportsdesigners, r/esportsjobs, r/europe_forhire, r/excelwork, r/for_hire, r/forhireafrica, r/forhirebitcoin, r/forhireuk, r/freelance_forhere, r/freelanceartist, r/freelancedesigners, r/freelanceindiaa, r/freelancejobs, r/freelanceph, r/freelanceproject, r/freelanceva, r/freelancingjobs, r/gamingjobs, r/gigindia, r/gigjobs, r/gigs254, r/gigsforcash, r/gigsph, r/gisjobs, r/graphicdesignrequest, r/hireacoder, r/hireadeveloper, r/hireaiartist, r/hireatranslator, r/hireatutor, r/hireavirtualassistant, r/hiringartists, r/hiringvideoeditor, r/hongkong_forhire, r/icanmodelthat, r/influencerjobs, r/irishdevjobs, r/jamstack_jobs, r/jobs4cryptos, r/jobsweb3, r/juniorwebdevjobs, r/lajobs, r/logorequest, r/london_forhire, r/londonjobs, r/marketerforhire, r/marketingjobshub, r/microtasks, r/musicservices, r/needawriter, r/onlinejobsph, r/onlineteachingjobs, r/onlytasks, r/paiddesign, r/paidremotejobs, r/pakgigshub, r/pakistanifreelancers, r/photoshoprequestspro, r/photshop_request, r/ppcjobs, r/progigs, r/programmersforhire, r/programmingtasks, r/quickfreelancers, r/remote_pm_jobs, r/remotegig, r/remotemarketingjobs, r/remotephp, r/remotesoftwareengjobs, r/remoteworkhiring, r/remoteworklatam, r/remotewritingjobs, r/requestalogo, r/robloxdevjobs, r/salesjobs, r/sgfreelancers, r/sidejob, r/socialmediajobs, r/swiftjobs, r/tasksforcash, r/tasksformoney, r/torontojobpostings, r/uaejobsalert, r/vegasjobs, r/videoeditingforhire, r/videoeditorforhiring, r/voiceactors, r/voiceoverrequests, r/vtuberartcommissions, r/vtuberartists, r/vuejobs, r/web3job, r/webdesignjobs, r/webforhire, r/webtoon_canvas_collab, r/workforhire, r/workwithindies, r/writingcommissions

## Also excluded, from research (not measured)

- **Hiring banned in posts:** r/freelance, r/Upwork, r/Fiverr, r/UKJobs, r/WorkOnline (bans for-hire posts), r/logodesign, r/photoshop, r/retouching, r/NewTubers (sends people to r/CreatorServices), r/startups, r/marketing.
- **Unpaid by design:** r/RecordThisForFree, r/Proofreading, r/translator, r/photorestore, r/cofounder, r/ProgrammingBuddies, r/TestMyApp, r/Favors.
- **Homework and essay mills:** r/HomeworkHelp, r/assignmentHelp, r/programminghomework, r/DoMyProgramming, r/College_Homework, r/homeworkhelpNY.
- **Scam or illegal:** r/HireaHacker and "account recovery" subreddits.
- **Survey and beermoney subreddits:** r/beermoney and similar.
- **NSFW commission and audio subreddits:** excluded on principle.

## Open items

- **AWS reachability.** Run the Cloud Shell test script in AWS CloudShell (free) before the worker is deployed.
- **Flair-filtered search.** Check whether `/r/<sub>/search.rss?q=flair:Paid&restrict_sr=on&sort=new` works. If it does, request boards like r/PhotoshopRequest could be polled for paid posts only.
- **Non-English subreddits.** Spanish, Portuguese, German and French freelance subreddits were not researched (the search budget ran out). The site-wide search feed will surface some of them.
- **Re-measure monthly.** Subreddits die and new ones appear: this list shrank by about 20 dead and gone subreddits in one check. The ingestion worker should keep per-subreddit volume stats, so this report can be regenerated from our own data.
