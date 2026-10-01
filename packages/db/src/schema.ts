import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

export const USER_STATUSES = ["active", "blocked"] as const;

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Cognito `sub` later; "dev|<normalized email>" in dev mode.
    authSub: text("auth_sub").notNull().unique(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull().unique(),
    status: text("status", { enum: USER_STATUSES }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => [
    check("users_status_check", sql`${table.status} in ('active', 'blocked')`),
  ],
);

export type User = typeof users.$inferSelect;

// Literal lists mirror @redlance/core (checked by onboarding.test.ts). drizzle-kit loads this
// file on its own, so it doesn't import core.
export const ONBOARDING_STEP_IDS = [
  "import",
  "basics",
  "skills",
  "rates",
] as const;
export const STEP_STATUSES = ["draft", "completed"] as const;
export const PROFILE_EXPERIENCE_LEVELS = [
  "beginner",
  "intermediate",
  "experienced",
] as const;
export const PROFILE_CURRENCIES = ["USD", "GBP", "EUR", "INR"] as const;
export const PROFILE_RATE_TYPES = ["hourly", "fixed", "either"] as const;
export const SKILL_LEVEL_VALUES = ["core", "secondary"] as const;
export const SKILL_SOURCE_VALUES = ["manual", "resume", "github"] as const;
// Only subreddits a paying user adds (later). Everyone's feed comes from the central catalogue.
export const SUBREDDIT_SOURCES = ["user"] as const;
export const SUBREDDIT_TIERS = ["core", "low", "regional", "custom"] as const;
export const SUBREDDIT_STATUSES = [
  "active",
  "excluded",
  "dead",
  "gone",
] as const;
export const ALERT_KINDS = ["email", "telegram"] as const;

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });
const v7Id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());
const emptyTextArray = sql`'{}'::text[]`;

export const skills = pgTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  aliases: text("aliases").array().notNull().default(emptyTextArray),
  retired: boolean("retired").notNull().default(false),
});

// The catalogue (seeded from @redlance/core). Stats columns are filled by the worker's nightly
// job from our own posts, and never overwritten by the seed sync. No foreign key to users on
// purpose: who added a custom subreddit lives in user_subreddits.
export const subreddits = pgTable(
  "subreddits",
  {
    name: text("name").primaryKey(),
    displayName: text("display_name").notNull(),
    categories: text("categories").array().notNull(),
    tier: text("tier", { enum: SUBREDDIT_TIERS }).notNull(),
    status: text("status", { enum: SUBREDDIT_STATUSES }).notNull(),
    note: text("note"),
    postsPerDay: real("posts_per_day"),
    hiringShare: real("hiring_share"),
    lastPostAt: timestamp("last_post_at", { withTimezone: true }),
    statsAt: timestamp("stats_at", { withTimezone: true }),
    /** Set by the worker after 30 days without posts: polled rarely until posts come back. */
    dormantSince: timestamp("dormant_since", { withTimezone: true }),
    /** Last successful poll of a feed containing this subreddit (gap detection survives re-plans). */
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    /** Set when Reddit refuses this subreddit on its own (banned, private, renamed). */
    unreachableSince: timestamp("unreachable_since", { withTimezone: true }),
    unreachableReason: text("unreachable_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    check("subreddits_name_check", sql`${t.name} ~ '^[a-z0-9_]{2,21}$'`),
    check(
      "subreddits_tier_check",
      sql`${t.tier} in (${sqlList(SUBREDDIT_TIERS)})`,
    ),
    check(
      "subreddits_status_check",
      sql`${t.status} in (${sqlList(SUBREDDIT_STATUSES)})`,
    ),
  ],
);

export const onboardingSteps = pgTable(
  "onboarding_steps",
  {
    userId: userId(),
    step: text("step", { enum: ONBOARDING_STEP_IDS }).notNull(),
    status: text("status", { enum: STEP_STATUSES }).notNull(),
    data: jsonb("data").$type<unknown>().notNull(),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.step] }),
    check(
      "onboarding_steps_step_check",
      sql`${t.step} in (${sqlList(ONBOARDING_STEP_IDS)})`,
    ),
    check(
      "onboarding_steps_status_check",
      sql`${t.status} in (${sqlList(STEP_STATUSES)})`,
    ),
    check(
      "onboarding_steps_data_size_check",
      sql`pg_column_size(${t.data}) <= 65536`,
    ),
  ],
);

export const profiles = pgTable(
  "profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    headline: text("headline").notNull().default(""),
    categories: text("categories").array().notNull(),
    experienceLevel: text("experience_level", {
      enum: PROFILE_EXPERIENCE_LEVELS,
    }).notNull(),
    country: text("country").notNull(),
    timeZone: text("time_zone").notNull(),
    // Optional GitHub link from the Import step (bare username). Drafts can link it.
    githubUsername: text("github_username"),
    minRateMinor: integer("min_rate_minor").notNull(),
    currency: text("currency", { enum: PROFILE_CURRENCIES }).notNull(),
    rateType: text("rate_type", { enum: PROFILE_RATE_TYPES }).notNull(),
    remoteOnly: boolean("remote_only").notNull(),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }).notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "profiles_experience_level_check",
      sql`${t.experienceLevel} in (${sqlList(PROFILE_EXPERIENCE_LEVELS)})`,
    ),
    check(
      "profiles_currency_check",
      sql`${t.currency} in (${sqlList(PROFILE_CURRENCIES)})`,
    ),
    check(
      "profiles_rate_type_check",
      sql`${t.rateType} in (${sqlList(PROFILE_RATE_TYPES)})`,
    ),
    check(
      "profiles_min_rate_check",
      sql`${t.minRateMinor} between 0 and 10000000`,
    ),
    check(
      "profiles_categories_check",
      sql`cardinality(${t.categories}) between 1 and 3`,
    ),
  ],
);

export const profileSkills = pgTable(
  "profile_skills",
  {
    userId: userId(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    level: text("level", { enum: SKILL_LEVEL_VALUES }).notNull(),
    source: text("source", { enum: SKILL_SOURCE_VALUES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.skillId] }),
    check(
      "profile_skills_level_check",
      sql`${t.level} in (${sqlList(SKILL_LEVEL_VALUES)})`,
    ),
    check(
      "profile_skills_source_check",
      sql`${t.source} in (${sqlList(SKILL_SOURCE_VALUES)})`,
    ),
  ],
);

export const customSkills = pgTable(
  "custom_skills",
  {
    id: v7Id(),
    userId: userId(),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    level: text("level", { enum: SKILL_LEVEL_VALUES }).notNull(),
    source: text("source", { enum: SKILL_SOURCE_VALUES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("custom_skills_user_name_unique").on(t.userId, t.nameNormalized),
    check(
      "custom_skills_level_check",
      sql`${t.level} in (${sqlList(SKILL_LEVEL_VALUES)})`,
    ),
    check(
      "custom_skills_source_check",
      sql`${t.source} in (${sqlList(SKILL_SOURCE_VALUES)})`,
    ),
  ],
);

// `subreddit` is plain text, not a foreign key: the dashboard will let users add boards
// outside the seed list. Ingestion decides which ones to poll.
export const userSubreddits = pgTable(
  "user_subreddits",
  {
    userId: userId(),
    subreddit: text("subreddit").notNull(),
    source: text("source", { enum: SUBREDDIT_SOURCES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.subreddit] }),
    check(
      "user_subreddits_source_check",
      sql`${t.source} in (${sqlList(SUBREDDIT_SOURCES)})`,
    ),
  ],
);

export const alertChannels = pgTable(
  "alert_channels",
  {
    id: v7Id(),
    userId: userId(),
    kind: text("kind", { enum: ALERT_KINDS }).notNull(),
    target: text("target").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("alert_channels_user_kind_unique").on(t.userId, t.kind),
    check(
      "alert_channels_kind_check",
      sql`${t.kind} in (${sqlList(ALERT_KINDS)})`,
    ),
  ],
);

export type Profile = typeof profiles.$inferSelect;

export const IMPORT_KINDS = ["resume", "github"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const IMPORT_STATUSES = ["queued", "running", "done", "failed"] as const;
export const IMPORT_STAGES = [
  "queued",
  "reading",
  "analysing",
  "checking",
  "done",
  "failed",
] as const;
export type ImportStage = (typeof IMPORT_STAGES)[number];
export const IMPORT_FILE_TYPES = ["pdf", "docx"] as const;
export const LLM_OUTCOMES = [
  "ok",
  "timeout",
  "error",
  "invalid_output",
] as const;

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const importJobs = pgTable(
  "import_jobs",
  {
    id: v7Id(),
    userId: userId(),
    kind: text("kind", { enum: IMPORT_KINDS }).notNull(),
    status: text("status", { enum: IMPORT_STATUSES })
      .notNull()
      .default("queued"),
    stage: text("stage", { enum: IMPORT_STAGES }).notNull().default("queued"),
    fileBytes: bytea("file_bytes"),
    fileType: text("file_type", { enum: IMPORT_FILE_TYPES }),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    sourceText: text("source_text"),
    contentHash: text("content_hash"),
    pipelineVersion: text("pipeline_version"),
    result: jsonb("result").$type<unknown>(),
    errorCode: text("error_code"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "import_jobs_kind_check",
      sql`${t.kind} in (${sqlList(IMPORT_KINDS)})`,
    ),
    check(
      "import_jobs_status_check",
      sql`${t.status} in (${sqlList(IMPORT_STATUSES)})`,
    ),
    check(
      "import_jobs_stage_check",
      sql`${t.stage} in (${sqlList(IMPORT_STAGES)})`,
    ),
    check(
      "import_jobs_file_type_check",
      sql`${t.fileType} is null or ${t.fileType} in (${sqlList(IMPORT_FILE_TYPES)})`,
    ),
    index("import_jobs_queue_idx")
      .on(t.status, t.runAfter)
      .where(sql`${t.status} = 'queued'`),
    index("import_jobs_user_idx").on(t.userId, t.createdAt),
    index("import_jobs_cache_idx")
      .on(t.contentHash, t.pipelineVersion)
      .where(sql`${t.status} = 'done'`),
  ],
);

export type ImportJob = typeof importJobs.$inferSelect;

// Cost records outlive users and jobs, so both references are SET NULL.
export const llmUsage = pgTable(
  "llm_usage",
  {
    id: v7Id(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    importJobId: uuid("import_job_id").references(() => importJobs.id, {
      onDelete: "set null",
    }),
    jobPostId: uuid("job_post_id").references(() => jobPosts.id, {
      onDelete: "set null",
    }),
    task: text("task").notNull(),
    step: text("step").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull(),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull(),
    latencyMs: integer("latency_ms").notNull(),
    attempt: integer("attempt").notNull(),
    outcome: text("outcome", { enum: LLM_OUTCOMES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "llm_usage_outcome_check",
      sql`${t.outcome} in (${sqlList(LLM_OUTCOMES)})`,
    ),
    index("llm_usage_created_idx").on(t.createdAt),
  ],
);

// ---- Ingestion (docs/ingestion/plan.md) ----
// Literal lists mirror @redlance/core's job-post.ts (checked by ingest.test.ts).

export const POST_SOURCES = ["reddit"] as const;
export const FETCHED_VIA = ["rss", "api"] as const;
export const PRE_KINDS = ["hiring", "for_hire", "unknown"] as const;
export const ANALYSIS_STATUSES = [
  "pending",
  "running",
  "done",
  "skipped",
  "failed",
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];
export const POST_KINDS = ["hiring", "for_hire", "other"] as const;
export const EMPLOYMENT_TYPES = [
  "freelance",
  "contract",
  "part_time",
  "full_time",
  "unknown",
] as const;
export const PAY_TYPES = [
  "paid",
  "commission_only",
  "revshare",
  "unpaid",
  "unknown",
] as const;
export const REMOTE_TYPES = ["remote", "onsite", "hybrid", "unknown"] as const;
export const BUDGET_UNITS = [
  "fixed",
  "hour",
  "day",
  "week",
  "month",
  "per_item",
] as const;
export const FEED_KINDS = ["subreddits", "search"] as const;
export const FEED_STATUSES = ["active", "retired"] as const;

/** One row per post, kept forever (rule 3). Raw facts only; analysis is in job_post_analyses. */
export const jobPosts = pgTable(
  "job_posts",
  {
    id: v7Id(),
    source: text("source", { enum: POST_SOURCES }).notNull(),
    externalId: text("external_id").notNull(),
    fetchedVia: text("fetched_via", { enum: FETCHED_VIA }).notNull(),
    community: text("community").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    author: text("author"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    firstSeenFeedId: uuid("first_seen_feed_id").references(() => feeds.id, {
      onDelete: "set null",
    }),
    preKind: text("pre_kind", { enum: PRE_KINDS }).notNull(),
    analysisStatus: text("analysis_status", { enum: ANALYSIS_STATUSES })
      .notNull()
      .default("pending"),
    analysisAttempts: integer("analysis_attempts").notNull().default(0),
    analysisRunAfter: timestamp("analysis_run_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    analysisLockedAt: timestamp("analysis_locked_at", { withTimezone: true }),
    analysisError: text("analysis_error"),
  },
  (t) => [
    unique("job_posts_source_external_unique").on(t.source, t.externalId),
    check(
      "job_posts_source_check",
      sql`${t.source} in (${sqlList(POST_SOURCES)})`,
    ),
    check(
      "job_posts_fetched_via_check",
      sql`${t.fetchedVia} in (${sqlList(FETCHED_VIA)})`,
    ),
    check(
      "job_posts_pre_kind_check",
      sql`${t.preKind} in (${sqlList(PRE_KINDS)})`,
    ),
    check(
      "job_posts_analysis_status_check",
      sql`${t.analysisStatus} in (${sqlList(ANALYSIS_STATUSES)})`,
    ),
    index("job_posts_analysis_queue_idx")
      .on(t.analysisRunAfter)
      .where(sql`${t.analysisStatus} = 'pending'`),
    index("job_posts_analysis_running_idx")
      .on(t.analysisLockedAt)
      .where(sql`${t.analysisStatus} = 'running'`),
    index("job_posts_community_posted_idx").on(t.community, t.postedAt),
    index("job_posts_posted_idx").on(t.postedAt),
    index("job_posts_author_idx").on(t.author),
  ],
);

export type JobPostRow = typeof jobPosts.$inferSelect;

/** The polling plan: rebuilt by the planner, state survives restarts. */
export const feeds = pgTable(
  "feeds",
  {
    id: v7Id(),
    kind: text("kind", { enum: FEED_KINDS }).notNull(),
    /** Sorted names, for kind = subreddits. */
    subreddits: text("subreddits").array(),
    /** For kind = search, e.g. "title:hiring". */
    query: text("query"),
    /** How often to poll. Under load every feed slips equally: the poller takes the most overdue. */
    intervalSeconds: integer("interval_seconds").notNull(),
    status: text("status", { enum: FEED_STATUSES }).notNull().default("active"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set when a poll found only new posts (a gap): page backwards from this id. */
    catchUpAfter: text("catch_up_after"),
    catchUpPagesLeft: integer("catch_up_pages_left").notNull().default(0),
    /** Keep paging back until posts are older than this (the previous successful poll). */
    catchUpUntil: timestamp("catch_up_until", { withTimezone: true }),
    consecutiveErrors: integer("consecutive_errors").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check("feeds_kind_check", sql`${t.kind} in (${sqlList(FEED_KINDS)})`),
    check("feeds_interval_check", sql`${t.intervalSeconds} >= 60`),
    check(
      "feeds_status_check",
      sql`${t.status} in (${sqlList(FEED_STATUSES)})`,
    ),
    check(
      "feeds_shape_check",
      sql`(${t.kind} = 'subreddits' and cardinality(${t.subreddits}) > 0 and ${t.query} is null)
        or (${t.kind} = 'search' and ${t.query} is not null and ${t.subreddits} is null)`,
    ),
    index("feeds_due_idx")
      .on(t.nextPollAt)
      .where(sql`${t.status} = 'active'`),
  ],
);

export type Feed = typeof feeds.$inferSelect;

/** One row per request. Operational log, pruned after 30 days. */
export const feedPolls = pgTable(
  "feed_polls",
  {
    id: v7Id(),
    feedId: uuid("feed_id").references(() => feeds.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    httpStatus: integer("http_status"),
    entries: integer("entries").notNull().default(0),
    newPosts: integer("new_posts").notNull().default(0),
    /** 0 = newest page; > 0 = a catch-up page. */
    page: integer("page").notNull().default(0),
    rateLimitRemaining: real("rate_limit_remaining"),
    rateLimitReset: integer("rate_limit_reset"),
    errorCode: text("error_code"),
  },
  (t) => [index("feed_polls_started_idx").on(t.startedAt)],
);

export type FeedPoll = typeof feedPolls.$inferSelect;

/** The latest analysis of each post. Bump pipeline_version to re-analyse. */
export const jobPostAnalyses = pgTable(
  "job_post_analyses",
  {
    jobPostId: uuid("job_post_id")
      .primaryKey()
      .references(() => jobPosts.id, { onDelete: "cascade" }),
    pipelineVersion: text("pipeline_version").notNull(),
    kind: text("kind", { enum: POST_KINDS }).notNull(),
    employmentType: text("employment_type", {
      enum: EMPLOYMENT_TYPES,
    }).notNull(),
    payType: text("pay_type", { enum: PAY_TYPES }).notNull(),
    categories: text("categories").array().notNull(),
    skillIds: text("skill_ids").array().notNull(),
    budgetMin: numeric("budget_min", {
      precision: 12,
      scale: 2,
      mode: "number",
    }),
    budgetMax: numeric("budget_max", {
      precision: 12,
      scale: 2,
      mode: "number",
    }),
    currency: text("currency"),
    budgetUnit: text("budget_unit", { enum: BUDGET_UNITS }),
    remote: text("remote", { enum: REMOTE_TYPES }).notNull(),
    location: text("location"),
    deadline: date("deadline", { mode: "string" }),
    redFlags: text("red_flags").array().notNull(),
    summary: text("summary").notNull(),
    model: text("model").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "job_post_analyses_kind_check",
      sql`${t.kind} in (${sqlList(POST_KINDS)})`,
    ),
    check(
      "job_post_analyses_employment_check",
      sql`${t.employmentType} in (${sqlList(EMPLOYMENT_TYPES)})`,
    ),
    check(
      "job_post_analyses_pay_check",
      sql`${t.payType} in (${sqlList(PAY_TYPES)})`,
    ),
    check(
      "job_post_analyses_remote_check",
      sql`${t.remote} in (${sqlList(REMOTE_TYPES)})`,
    ),
    check(
      "job_post_analyses_budget_unit_check",
      sql`${t.budgetUnit} is null or ${t.budgetUnit} in (${sqlList(BUDGET_UNITS)})`,
    ),
    check(
      "job_post_analyses_budget_check",
      sql`${t.budgetMin} is null or ${t.budgetMax} is null or ${t.budgetMin} <= ${t.budgetMax}`,
    ),
    check(
      "job_post_analyses_currency_check",
      sql`${t.currency} is null or ${t.currency} ~ '^[A-Z]{3}$'`,
    ),
    index("job_post_analyses_kind_idx").on(t.kind, t.createdAt),
  ],
);

export type JobPostAnalysis = typeof jobPostAnalyses.$inferSelect;
