import { z } from "zod";

// The common shape every source adapter emits (rule 2): matching, drafting and alerts never
// look at where a post came from. Literal lists are mirrored in @redlance/db's schema
// (checked by packages/db/src/ingest.test.ts).

export const POST_SOURCES = ["reddit"] as const;
export type PostSource = (typeof POST_SOURCES)[number];

/** How the post was fetched. The same Reddit post has the same id over RSS and the API. */
export const FETCHED_VIA = ["rss", "api"] as const;
export type FetchedVia = (typeof FETCHED_VIA)[number];

export const MAX_POST_TITLE = 300;
export const MAX_POST_BODY = 20_000;

export const jobPostSchema = z.object({
  source: z.enum(POST_SOURCES),
  externalId: z.string().regex(/^t3_[a-z0-9]{1,16}$/),
  fetchedVia: z.enum(FETCHED_VIA),
  /** Subreddit, lowercase, no "r/". */
  community: z.string().regex(/^[a-z0-9_]{2,21}$/),
  url: z.url({ protocol: /^https$/, hostname: /^www\.reddit\.com$/ }),
  title: z.string().max(MAX_POST_TITLE),
  body: z.string().max(MAX_POST_BODY),
  /** Username without "u/"; null when the account is deleted. */
  author: z.string().max(40).nullable(),
  postedAt: z.date(),
  sourceUpdatedAt: z.date().nullable(),
});
export type JobPost = z.infer<typeof jobPostSchema>;

// ---- What the analyser extracts (Phase 3) ----

export const POST_KINDS = ["hiring", "for_hire", "other"] as const;
export type PostKind = (typeof POST_KINDS)[number];

/** Free title-tag guess, set when the post is saved. */
export const PRE_KINDS = ["hiring", "for_hire", "unknown"] as const;
export type PreKind = (typeof PRE_KINDS)[number];

export const EMPLOYMENT_TYPES = [
  "freelance",
  "contract",
  "part_time",
  "full_time",
  "unknown",
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const PAY_TYPES = [
  "paid",
  "commission_only",
  "revshare",
  "unpaid",
  "unknown",
] as const;
export type PayType = (typeof PAY_TYPES)[number];

export const REMOTE_TYPES = ["remote", "onsite", "hybrid", "unknown"] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];

export const BUDGET_UNITS = [
  "fixed",
  "hour",
  "day",
  "week",
  "month",
  "per_item",
] as const;
export type BudgetUnit = (typeof BUDGET_UNITS)[number];

export const RED_FLAGS = [
  "asks_for_free_work",
  "off_platform_payment",
  "upfront_fee",
  "vague_pay",
  "unrealistic_pay",
  "personal_info_request",
  "adult_content",
  "academic_dishonesty",
] as const;
export type RedFlag = (typeof RED_FLAGS)[number];
