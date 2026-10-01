# Docs

`PROJECT.md` is the product spec. Everything else is grouped by feature: each folder holds that feature's design, build plans and research.

| Folder | What's in it | Status |
|---|---|---|
| `foundation/` | `local-dev-design.md` + `local-dev-plan.md` (Docker Postgres and Valkey, API conventions, rate limits, dev auth); `cdn-waf-design.md` (CloudFront, WAF, Route 53 with CDK) | Local dev built. CDN/WAF partly outdated, not built |
| `homepage/` | `attio-teardown.md`: the layout study the homepage follows | Built |
| `onboarding/` | `design.md`; `plan-slice-1.md` (manual steps); `plan-slices-2-3.md` (worker, resume and GitHub import) | Built on `feat/onboarding` |
| `ingestion/` | `plan.md`: collecting Reddit posts and understanding them, in phases. `research/`: the subreddit study (report plus raw data) | Plan for review |

New feature? Add a folder named after it with a `design.md` (or `plan.md`) and, if needed, `research/`.
