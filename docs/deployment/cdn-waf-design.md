# Foundation, CDN and WAF (Phases 0–2) — design

Date: 2026-09-26 · Status: draft for review

> **Not built, and partly out of date (2026-10-17).** Nothing here exists yet: no `infra/`, no Dockerfile, no CI. Since this was written:
> - CloudFront's origin is **one EC2 server** running the app (web + worker) in Docker. The "static export to S3" setup in Phase 1 is replaced, though static assets are still cached at the edge.
> - Postgres runs in Docker on that server (no RDS) and Redis is Upstash (no ElastiCache), replacing the "ALB → Fargate → RDS / Valkey" path.
> - The CloudFront flat-rate Free plan has no VPC origins, so the server is locked to CloudFront by its security group and a secret header. The flat-rate plan itself hasn't been confirmed yet.
> - The checklist for the deployment spec is in `CLAUDE.md` ("Deployment spec").
>
> Still valid: Route 53 + ACM + budgets (Phase 0) and the WAF rules (Phase 2). Rewrite this file as `docs/deployment/design.md` when deployment starts.

## Goal

Put the marketing site live at `https://redlance.app`, served from AWS CloudFront and protected by AWS WAF, with every AWS resource defined in code. This is the first slice of the production request path agreed for Redlance:

```
Browser → CloudFront (CDN) → WAF → [later: ALB → ECS Fargate → RDS / Valkey / Cognito]
```

Phases 0–2 build the left half. Later phases (ALB and app server, database and Redis, login) get their own specs and plug into what this one creates.

## Decisions this spec relies on

| Decision | Source |
|---|---|
| All AWS, region `us-east-1`, infrastructure as code with AWS CDK (TypeScript) | Conversation 2026-09-26, recorded in `CLAUDE.md` |
| Domain `redlance.app` (Name.com), DNS on Route 53 | Registered 2026-09-26 |
| No AWS API Gateway; CloudFront + WAF is the gateway, ALB comes in Phase 3 | Conversation 2026-09-26 |
| CloudFront **flat-rate Free plan** (covers CloudFront, WAF, Route 53 zone, logs) | Cost review 2026-09-26; **confirm in review** |

## Scope

In scope:

- Phase 0 — AWS account safety, CDK project, Route 53 zone, TLS certificate, budget alerts, GitHub deploy role.
- Phase 1 — Next.js static export uploaded to a private S3 bucket, served by CloudFront on `redlance.app`, deployed from GitHub Actions.
- Phase 2 — WAF web ACL on the distribution: managed rules plus a per-IP rate limit.

Out of scope (later specs): ALB, ECS, RDS, Valkey, Cognito, SES, SQS, a staging environment, Content-Security-Policy.

## Phase 0 — Foundations

### Manual steps (owner: Aryan, one time)

1. AWS account: MFA on the root user; stop using root after setup.
2. IAM Identity Center: one admin user for daily work; sign in with `aws configure sso` (AWS CLI v2 via `brew install awscli`).
3. Credits: apply to AWS Activate (Founders) using `redlance.app`.
4. After the Route 53 zone exists (below), paste its 4 nameservers into Name.com → Domain → Nameservers.
5. Subscribe the distribution to the CloudFront flat-rate Free plan in the console (CDK does not manage plan subscriptions) and attach the Route 53 zone to the plan.

### In code: `infra/` workspace (`@redlance/infra`)

```
infra/
  bin/redlance.ts          app entry; one environment ("prod") for now
  lib/foundation-stack.ts  hosted zone, certificate, budgets, GitHub OIDC role
  lib/edge-stack.ts        S3 bucket, CloudFront, CloudFront Function, headers policy, WAF
  lib/config.ts            domain, account, region, budget thresholds, repo name
  test/                    CDK assertion tests (snapshot + key properties)
```

- Every resource is tagged `project=redlance`, `phase=<foundation|cdn|waf>`, `env=prod`, so Cost Explorer can split spend by phase.
- Stacks deploy locally with `npx cdk deploy` for now. Infrastructure CI comes with Phase 3.

`FoundationStack` creates:

| Resource | Details |
|---|---|
| Route 53 public hosted zone | `redlance.app` |
| ACM certificate | `redlance.app` + `www.redlance.app`, DNS-validated in the zone. Must be in `us-east-1` for CloudFront. |
| AWS Budgets | Monthly cost budget with email alerts at $25, $50, $100 (actual) and $50 (forecast) |
| GitHub OIDC provider + deploy role | Trusts only `repo:Redlancing/Redlance:ref:refs/heads/main`. Allowed: write to the site bucket, create CloudFront invalidations. No long-lived keys. |

## Phase 1 — CDN

### Next.js static export

`apps/web/next.config.ts` gains `output: "export"` and `trailingSlash: true`, so `next build` writes `apps/web/out/` with `index.html` per route. The site today is one static page with no server-only features. Phase 3 removes `output: "export"` when the app server arrives.

### Request flow

```
GET https://redlance.app/pricing/
  → CloudFront edge (TLS 1.3, HTTP/2 and HTTP/3)
  → WAF (Phase 2)
  → CloudFront Function (viewer request):
       www.redlance.app/*  → 301 to https://redlance.app/*
       /pricing or /pricing/ → /pricing/index.html
  → cache hit: served from the edge
  → cache miss: fetched from S3 through Origin Access Control, then cached
```

### Resources (`EdgeStack`)

| Resource | Details |
|---|---|
| S3 bucket | Private, all public access blocked, SSE-S3 encryption, versioning on, lifecycle: delete non-current versions after 30 days. Readable only by this distribution (OAC). |
| CloudFront distribution | Aliases `redlance.app`, `www.redlance.app`; the ACM certificate; HTTPS only (HTTP → HTTPS redirect); compression on; price class All; default root object `index.html`; 404 → `/404.html` with status 404. |
| Cache behaviour `/_next/static/*` | Managed `CachingOptimized` policy. Objects uploaded with `Cache-Control: public, max-age=31536000, immutable`. |
| Default cache behaviour | Managed `CachingOptimized`. HTML uploaded with `Cache-Control: public, max-age=0, s-maxage=300`, and invalidated on every deploy. |
| CloudFront Function | The `www` redirect and index rewrite above. |
| Response headers policy | HSTS (2 years, includeSubDomains, preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`. CSP is deferred to Phase 3, where the server can issue nonces. |
| Route 53 records | `A`/`AAAA` alias for `redlance.app` and `www.redlance.app` → the distribution. |

### Deploy pipeline (`.github/workflows/deploy-web.yml`)

Runs on push to `main` when `apps/web/**` changes:

1. `npm ci`, then `npm run lint`, `npm run typecheck`, `npm run build`.
2. Assume the deploy role through OIDC.
3. Upload `out/_next/static/` with the immutable cache header and **without** `--delete`, so assets from older builds stay available to users mid-visit.
4. Upload everything else with the short HTML cache header, with `--delete` (excluding `_next/static/`).
5. Invalidate `/*`.

The order (assets first, HTML last) means no HTML ever points to an asset that isn't uploaded yet.

## Phase 2 — WAF

One web ACL (scope `CLOUDFRONT`, in `us-east-1`) attached to the distribution. The Free flat-rate plan allows 5 rules, used in this order:

| # | Rule | Purpose | Action at launch |
|---|---|---|---|
| 1 | `block-ip-set` (custom IP set, empty) | Emergency blocking in seconds | Block |
| 2 | `AWSManagedRulesAmazonIpReputationList` | Known bad IPs and botnets | Count |
| 3 | `AWSManagedRulesCommonRuleSet` | SQL injection, XSS, path traversal and similar | Count |
| 4 | `AWSManagedRulesKnownBadInputsRuleSet` | Exploit patterns (e.g. Log4j) | Count |
| 5 | `rate-limit-per-ip` | Sliding 5-minute window, 2,000 requests per IP (every asset request counts, so the limit is generous) | Count |

- **Rollout:** rules 2–5 start in **Count** mode. After 3–7 days of clean logs we switch them to **Block** (a one-line config change each).
- **Blocked by the rate rule:** HTTP 429 with a short custom body ("Too many requests. Please wait a few minutes.").
- **Logging:** CloudWatch Logs group `aws-waf-logs-redlance`, 14-day retention; redact the `cookie` and `authorization` headers from logs.
- The stricter login-route limit planned for Phase 5 goes into the app's Redis limiter, because the Free plan's 5 rules are used here.

## Cost

| Item | Monthly |
|---|---|
| CloudFront, WAF, Route 53 zone, WAF log ingestion | $0 on the Free flat-rate plan (allowance: 1M requests, 100 GB) |
| S3 storage | Covered by the plan's 5 GB S3 credit |
| ACM certificate, AWS Budgets (first two budgets) | $0 |
| **Total** | **≈ $0** |

Going over the plan's allowance never adds charges; AWS may reduce delivery performance instead and will email as usage approaches the limit. Upgrade path: Pro plan ($15/month, 10M requests, 25 WAF rules).

## Verification (definition of done)

Phase 0:
- `dig NS redlance.app` returns the Route 53 nameservers.
- The ACM certificate shows `Issued`.
- The budget alert email address is confirmed.
- A GitHub Actions run can assume the deploy role; a run from another branch cannot.

Phase 1:
- `https://redlance.app` loads the homepage; `http://` and `www.` both 301 to `https://redlance.app`.
- A second request shows `x-cache: Hit from cloudfront`.
- `/_next/static/*` responses carry `max-age=31536000, immutable`; HTML carries `s-maxage=300`.
- The raw S3 bucket URL returns `403 AccessDenied`.
- An unknown path returns the 404 page with status 404.
- Security headers are present (checked with `curl -I`).
- A push to `main` deploys, and the change is visible within a minute.

Phase 2:
- The web ACL is attached to the distribution.
- A load script sending ~3,000 requests from one IP within 5 minutes appears as `rate-limit-per-ip` matches in the WAF logs (Count mode), and gets 429s once the rule is switched to Block.
- Normal browsing produces no managed-rule matches over the observation window before switching to Block.

## Risks and notes

- **Trademark:** the USPTO / UK IPO check for "Redlance" is still pending. Infrastructure is name-agnostic apart from `lib/config.ts`, so a rename only changes the domain values and certificate.
- **Flat-rate plan limits:** no VPC origins on Free/Pro. In Phase 3 the ALB will be public but only accept CloudFront (CloudFront's managed prefix list in the security group plus a secret origin header).
- **`.app` is HSTS-preloaded** by the registry: the site only ever works over HTTPS, which matches this design.
- **Nameserver change** at Name.com can take up to 48 hours to spread, though it's usually under an hour.
