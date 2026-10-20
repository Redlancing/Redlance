import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  type AnyPgColumn,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
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
  "work",
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
// Projects & experience (core work.ts).
export const PROJECT_ROLES = ["solo", "lead", "team", "unknown"] as const;
export const PROJECT_KINDS = [
  "client",
  "employer",
  "personal",
  "open_source",
  "academic",
  "hackathon",
  "unknown",
] as const;
export const ROLE_EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "freelance",
  "contract",
  "internship",
  "unknown",
] as const;
export const ENTRY_SOURCES = ["resume", "manual"] as const;
// Matching (core matching/constants.ts and plans.ts).
export const PLANS = ["trial", "standard", "max"] as const;
export const MATCH_STATUSES = [
  "new",
  "seen",
  "saved",
  "dismissed",
  "replied",
] as const;
export const AI_STATUSES = [
  "not_needed",
  "pending",
  "running",
  "done",
  "failed",
  "capped",
] as const;
/** Every status change is an event. */
export const MATCH_EVENTS = MATCH_STATUSES;
// Alerts (core alerts/constants.ts).
export const ALERT_OUTCOMES = [
  "queued",
  "sent",
  "failed",
  "below_threshold",
  "skipped_backfill",
  "skipped_stale",
  "skipped_trial",
  "skipped_cap",
  "skipped_no_channel",
  "skipped_withdrawn",
] as const;
export const DELIVERY_CHANNELS = ["telegram"] as const;
export const DELIVERY_STATUSES = ["pending", "sending", "failed"] as const;
export const CHANNEL_DISABLED_REASONS = [
  "blocked",
  "user_stop",
  "relinked",
] as const;
/** job_posts.match_status (the matcher's queue); null = not analysed yet. */
export const POST_MATCH_STATUSES = [
  "pending",
  "running",
  "done",
  "skipped",
] as const;

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
    // Drafts name employers only when this is on; otherwise they use organisation_description.
    mentionEmployers: boolean("mention_employers").notNull().default(false),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }).notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }).notNull(),
    /** Set by hand (SQL) until billing exists. */
    plan: text("plan", { enum: PLANS }).notNull().default("trial"),
    /** Shows unpaid, commission-only and revshare posts. */
    includeUnpaid: boolean("include_unpaid").notNull().default(false),
    /** A pending re-match request: match posts since this time (the matcher clears it). */
    rematchSince: timestamp("rematch_since", { withTimezone: true }),
    /** The matcher's lease on the request; an old one (crashed matcher) can be claimed again. */
    rematchClaimedAt: timestamp("rematch_claimed_at", { withTimezone: true }),
    /** Claims of the current request; it is dropped after MAX_REMATCH_ATTEMPTS. */
    rematchAttempts: integer("rematch_attempts").notNull().default(0),
    /** Backoff after a failed re-match: not claimed again before this. */
    rematchAfter: timestamp("rematch_after", { withTimezone: true }),
    /** Bumped when matching-relevant profile data changes; matches remember the version. */
    profileVersion: integer("profile_version").notNull().default(1),
    /** Alerts: only matches scoring at least this are sent. */
    alertMinScore: integer("alert_min_score").notNull().default(70),
    /** Alerts: at most this many a day (the user's local day). */
    alertsDailyCap: integer("alerts_daily_cap").notNull().default(20),
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
    check("profiles_plan_check", sql`${t.plan} in (${sqlList(PLANS)})`),
    check("profiles_profile_version_check", sql`${t.profileVersion} >= 1`),
    check("profiles_rematch_attempts_check", sql`${t.rematchAttempts} >= 0`),
    check(
      "profiles_alert_min_score_check",
      sql`${t.alertMinScore} between 0 and 100`,
    ),
    check(
      "profiles_alerts_daily_cap_check",
      sql`${t.alertsDailyCap} between 1 and 100`,
    ),
    index("profiles_rematch_idx")
      .on(t.rematchSince)
      .where(sql`${t.rematchSince} is not null`),
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

// Projects and roles from the "Projects & experience" step, written once by Finish like
// profile_skills. Tags are arrays, not join tables: matching reads one user's few entries at a
// time. skill_ids has no foreign key; the app validates the ids (retired ones stay valid).
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const textArray = (name: string) =>
  text(name).array().notNull().default(emptyTextArray);
const entryColumns = () => ({
  id: v7Id(),
  userId: userId(),
  /** Order shown and used: the index in the step's list. */
  position: smallint("position").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  skillIds: textArray("skill_ids"),
  categories: textArray("categories"),
  domains: textArray("domains"),
  source: text("source", { enum: ENTRY_SOURCES }).notNull(),
  /** Kept, but never used in drafts. */
  hidden: boolean("hidden").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
type EntryColumns = Record<keyof ReturnType<typeof entryColumns>, AnyPgColumn>;
/** The index and CHECKs both tables share; `maxPosition` is the list's limit. */
const entryChecks = (prefix: string, t: EntryColumns, maxPosition: number) => [
  index(`${prefix}_user_position_idx`).on(t.userId, t.position),
  check(
    `${prefix}_position_check`,
    sql`${t.position} >= 0 and ${t.position} < ${sql.raw(String(maxPosition))}`,
  ),
  check(`${prefix}_title_check`, sql`char_length(${t.title}) between 1 and 80`),
  check(`${prefix}_summary_check`, sql`char_length(${t.summary}) <= 160`),
  check(`${prefix}_skill_ids_check`, sql`cardinality(${t.skillIds}) <= 10`),
  check(`${prefix}_categories_check`, sql`cardinality(${t.categories}) <= 2`),
  check(`${prefix}_domains_check`, sql`cardinality(${t.domains}) <= 4`),
  check(
    `${prefix}_source_check`,
    sql`${t.source} in (${sqlList(ENTRY_SOURCES)})`,
  ),
];

export const profileProjects = pgTable(
  "profile_projects",
  {
    ...entryColumns(),
    role: text("role", { enum: PROJECT_ROLES }).notNull(),
    kind: text("kind", { enum: PROJECT_KINDS }).notNull(),
    outcomes: textArray("outcomes"),
    links: textArray("links"),
    year: smallint("year"),
  },
  (t) => [
    ...entryChecks("profile_projects", t, 8),
    check(
      "profile_projects_role_check",
      sql`${t.role} in (${sqlList(PROJECT_ROLES)})`,
    ),
    check(
      "profile_projects_kind_check",
      sql`${t.kind} in (${sqlList(PROJECT_KINDS)})`,
    ),
    check(
      "profile_projects_outcomes_check",
      sql`cardinality(${t.outcomes}) <= 3`,
    ),
    check("profile_projects_links_check", sql`cardinality(${t.links}) <= 3`),
    check(
      "profile_projects_year_check",
      sql`${t.year} is null or ${t.year} between 1950 and 2100`,
    ),
  ],
);

export type ProfileProject = typeof profileProjects.$inferSelect;

export const profileExperience = pgTable(
  "profile_experience",
  {
    ...entryColumns(),
    /** Null for freelance and contract roles: there it is often a client. */
    organisation: text("organisation"),
    organisationDescription: text("organisation_description").notNull(),
    employmentType: text("employment_type", {
      enum: ROLE_EMPLOYMENT_TYPES,
    }).notNull(),
    startYear: smallint("start_year"),
    startMonth: smallint("start_month"),
    endYear: smallint("end_year"),
    endMonth: smallint("end_month"),
    isCurrent: boolean("is_current").notNull().default(false),
    highlights: textArray("highlights"),
  },
  (t) => [
    ...entryChecks("profile_experience", t, 6),
    check(
      "profile_experience_organisation_check",
      sql`char_length(${t.organisation}) <= 80`,
    ),
    check(
      "profile_experience_organisation_description_check",
      sql`char_length(${t.organisationDescription}) <= 60`,
    ),
    check(
      "profile_experience_employment_type_check",
      sql`${t.employmentType} in (${sqlList(ROLE_EMPLOYMENT_TYPES)})`,
    ),
    check(
      "profile_experience_free_organisation_check",
      sql`${t.employmentType} not in ('freelance', 'contract') or ${t.organisation} is null`,
    ),
    check(
      "profile_experience_start_check",
      sql`(${t.startYear} is null or ${t.startYear} between 1950 and 2100)
        and (${t.startMonth} is null or (${t.startYear} is not null and ${t.startMonth} between 1 and 12))`,
    ),
    check(
      "profile_experience_end_check",
      sql`(${t.endYear} is null or ${t.endYear} between 1950 and 2100)
        and (${t.endMonth} is null or (${t.endYear} is not null and ${t.endMonth} between 1 and 12))`,
    ),
    check(
      "profile_experience_current_check",
      sql`not ${t.isCurrent} or (${t.endYear} is null and ${t.endMonth} is null)`,
    ),
    check(
      "profile_experience_highlights_check",
      sql`cardinality(${t.highlights}) <= 4`,
    ),
  ],
);

export type ProfileExperience = typeof profileExperience.$inferSelect;

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
    /** Why `enabled` is false: the bot was blocked, the user turned alerts off, or another account took the chat. */
    disabledReason: text("disabled_reason", {
      enum: CHANNEL_DISABLED_REASONS,
    }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("alert_channels_user_kind_unique").on(t.userId, t.kind),
    check(
      "alert_channels_kind_check",
      sql`${t.kind} in (${sqlList(ALERT_KINDS)})`,
    ),
    check(
      "alert_channels_disabled_reason_check",
      sql`${t.disabledReason} is null or ${t.disabledReason} in (${sqlList(CHANNEL_DISABLED_REASONS)})`,
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
    // Per-user daily cost checks run on every draft request.
    index("llm_usage_user_created_idx").on(t.userId, t.createdAt),
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
    /** The earlier cross-post this is a copy of (never itself a duplicate); null for originals. */
    duplicateOf: uuid("duplicate_of").references(
      (): AnyPgColumn => jobPosts.id,
      { onDelete: "set null" },
    ),
    /** The matcher's queue: set by completePostAnalysis. Null = not analysed yet (or older). */
    matchStatus: text("match_status", { enum: POST_MATCH_STATUSES }),
    matchAttempts: integer("match_attempts").notNull().default(0),
    matchLockedAt: timestamp("match_locked_at", { withTimezone: true }),
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
    index("job_posts_author_posted_idx").on(t.author, t.postedAt),
    index("job_posts_duplicate_of_idx")
      .on(t.duplicateOf)
      .where(sql`${t.duplicateOf} is not null`),
    check(
      "job_posts_match_status_check",
      sql`${t.matchStatus} is null or ${t.matchStatus} in (${sqlList(POST_MATCH_STATUSES)})`,
    ),
    index("job_posts_match_queue_idx")
      .on(t.postedAt.desc())
      .where(sql`${t.matchStatus} = 'pending'`),
    index("job_posts_match_running_idx")
      .on(t.matchLockedAt)
      .where(sql`${t.matchStatus} = 'running'`),
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
    /** How the post says to apply (e.g. "email X with Y"); null when it doesn't say. */
    applyInstructions: text("apply_instructions"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "job_post_analyses_apply_instructions_check",
      sql`${t.applyInstructions} is null or char_length(${t.applyInstructions}) <= 300`,
    ),
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

// ---- Matching (docs/matching/plan/03-database.md) ----

/** One row per (user, post) the rules matched. Upserted by the matcher, scored by the re-scorer. */
export const matches = pgTable(
  "matches",
  {
    id: v7Id(),
    userId: userId(),
    jobPostId: uuid("job_post_id")
      .notNull()
      .references(() => jobPosts.id, { onDelete: "cascade" }),
    /** Copy of job_posts.posted_at (never changes): the feed's keyset index needs it here. */
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    ruleScore: integer("rule_score").notNull(),
    broad: boolean("broad").notNull(),
    /** core `Feature[]`: the rule score's breakdown, kept for tuning. */
    features: jsonb("features")
      .$type<{ signal: string; points: number; detail?: string[] }[]>()
      .notNull(),
    ruleReason: text("rule_reason").notNull(),
    aiStatus: text("ai_status", { enum: AI_STATUSES }).notNull(),
    aiAttempts: integer("ai_attempts").notNull().default(0),
    aiRunAfter: timestamp("ai_run_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    aiLockedAt: timestamp("ai_locked_at", { withTimezone: true }),
    /** An error code only, never text from the model or the post. */
    aiError: text("ai_error"),
    aiScore: integer("ai_score"),
    aiReason: text("ai_reason"),
    aiConcerns: textArray("ai_concerns"),
    aiModel: text("ai_model"),
    aiScoredAt: timestamp("ai_scored_at", { withTimezone: true }),
    bestProjectId: uuid("best_project_id").references(
      () => profileProjects.id,
      { onDelete: "set null" },
    ),
    bestRoleId: uuid("best_role_id").references(() => profileExperience.id, {
      onDelete: "set null",
    }),
    /** The final score: ai_score once AI is done, else rule_score. */
    score: integer("score").notNull(),
    status: text("status", { enum: MATCH_STATUSES }).notNull().default("new"),
    profileVersion: integer("profile_version").notNull(),
    /**
     * The analysis (job_post_analyses.created_at, to the millisecond) the rule score was
     * computed from. A row is only replaced by a strictly newer (profile_version, analysed_at).
     */
    analysedAt: timestamp("analysed_at", { withTimezone: true }).notNull(),
    /** Set when the match no longer qualifies (re-analysis, profile change): out of the feed. */
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    /** The UTC day whose re-score unit this pair used (for the re-scorer's cap accounting). */
    aiUnitDay: date("ai_unit_day", { mode: "string" }),
    /** When the AI re-score finished (done, failed or capped). */
    aiFinishedAt: timestamp("ai_finished_at", { withTimezone: true }),
    // Alerts. Set once by the router and sender; a re-analysis never resets them.
    /** The router's decision; null = not routed yet. */
    alertOutcome: text("alert_outcome", { enum: ALERT_OUTCOMES }),
    alertRoutedAt: timestamp("alert_routed_at", { withTimezone: true }),
    /** When the first alert for this match was delivered. */
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
    /** Channels the alert reached. */
    alertChannels: textArray("alert_channels"),
    /** The score when routed (the match's score can change later). */
    alertScore: integer("alert_score"),
    /** The message template version, e.g. "tg@1". */
    alertTemplate: text("alert_template"),
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("matches_user_post_unique").on(t.userId, t.jobPostId),
    check(
      "matches_alert_outcome_check",
      sql`${t.alertOutcome} is null or ${t.alertOutcome} in (${sqlList(ALERT_OUTCOMES)})`,
    ),
    check(
      "matches_alert_score_check",
      sql`${t.alertScore} is null or ${t.alertScore} between 0 and 100`,
    ),
    // The router's queue.
    index("matches_alert_route_idx")
      .on(t.createdAt)
      .where(sql`${t.alertOutcome} is null`),
    // The daily cap count.
    index("matches_user_routed_idx")
      .on(t.userId, t.alertRoutedAt)
      .where(sql`${t.alertOutcome} in ('queued', 'sent', 'failed')`),
    check("matches_rule_score_check", sql`${t.ruleScore} between 0 and 100`),
    check("matches_score_check", sql`${t.score} between 0 and 100`),
    check(
      "matches_ai_score_check",
      sql`${t.aiScore} is null or ${t.aiScore} between 0 and 100`,
    ),
    check(
      "matches_rule_reason_check",
      sql`char_length(${t.ruleReason}) <= 160`,
    ),
    check(
      "matches_ai_reason_check",
      sql`${t.aiReason} is null or char_length(${t.aiReason}) <= 160`,
    ),
    check("matches_ai_concerns_check", sql`cardinality(${t.aiConcerns}) <= 3`),
    check(
      "matches_ai_status_check",
      sql`${t.aiStatus} in (${sqlList(AI_STATUSES)})`,
    ),
    check(
      "matches_status_check",
      sql`${t.status} in (${sqlList(MATCH_STATUSES)})`,
    ),
    // Broad matches never go to AI re-scoring (decided 2026-10-17).
    check(
      "matches_broad_ai_check",
      sql`not ${t.broad} or ${t.aiStatus} = 'not_needed'`,
    ),
    check("matches_ai_attempts_check", sql`${t.aiAttempts} >= 0`),
    index("matches_user_status_idx").on(t.userId, t.status),
    index("matches_ai_queue_idx")
      .on(t.ruleScore.desc(), t.createdAt.desc())
      .where(sql`${t.aiStatus} = 'pending'`),
    index("matches_ai_running_idx")
      .on(t.aiLockedAt)
      .where(sql`${t.aiStatus} = 'running'`),
    index("matches_job_post_idx").on(t.jobPostId),
    // The feed: one user's matches, newest post first, keyset on (posted_at, id).
    index("matches_feed_idx")
      .on(t.userId, t.postedAt.desc(), t.id.desc())
      .where(sql`${t.status} <> 'dismissed' and ${t.withdrawnAt} is null`),
  ],
);

export type Match = typeof matches.$inferSelect;

/** Every status change (seen, saved, dismissed, replied): the history learning uses later. */
export const matchEvents = pgTable(
  "match_events",
  {
    id: v7Id(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    userId: userId(),
    event: text("event", { enum: MATCH_EVENTS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "match_events_event_check",
      sql`${t.event} in (${sqlList(MATCH_EVENTS)})`,
    ),
    index("match_events_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/** AI re-scores used per user per UTC day: the plan's daily cap. */
export const rescoreUsage = pgTable(
  "rescore_usage",
  {
    userId: userId(),
    day: date("day", { mode: "string" }).notNull(),
    used: integer("used").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.day] }),
    check("rescore_usage_used_check", sql`${t.used} >= 0`),
  ],
);

// ---- Drafts and the reply tracker (docs/drafts/README.md §13) ----

// Literal lists mirror @redlance/core (checked by drafts-schema.test.ts).
export const DRAFT_STATUS_VALUES = [
  "pending",
  "running",
  "done",
  "failed",
] as const;
export const DRAFT_KIND_VALUES = ["draft", "rewrite"] as const;
export const REWRITE_OPTION_VALUES = [
  "shorter",
  "casual",
  "formal",
  "different_project",
  "custom",
] as const;
export const REPLY_KIND_VALUES = ["comment", "dm"] as const;
export const REPLY_STATUS_VALUES = [
  "sent",
  "replied",
  "hired",
  "lost",
  "no_reply",
  "ghosted",
] as const;
export const OUTCOME_TYPE_VALUES = [
  "replied",
  "hired",
  "lost",
  "no_reply",
  "ghosted",
  "unpaid",
] as const;
export const LEDGER_REASON_VALUES = [
  "grant",
  "reserve",
  "refund",
  "expire",
  "adjust",
] as const;
export const EVAL_CANDIDATE_REASON_VALUES = [
  "validator_failed_twice",
  "heavy_edit",
  "many_rewrites",
  "thumbs_down",
] as const;
export const EVAL_REVIEW_STATUS_VALUES = [
  "pending",
  "added",
  "skipped",
] as const;
export const VOICE_UPDATE_STATUS_VALUES = [
  "idle",
  "pending",
  "running",
] as const;
export const EXAMPLE_SOURCE_VALUES = ["handwritten", "winning"] as const;

/** One AI-written comment + DM for a match; a rewrite is a new row (version 2-5). */
export const drafts = pgTable(
  "drafts",
  {
    id: v7Id(),
    userId: userId(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    jobPostId: uuid("job_post_id")
      .notNull()
      .references(() => jobPosts.id),
    version: smallint("version").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => drafts.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: DRAFT_KIND_VALUES }).notNull(),
    option: text("option", { enum: REWRITE_OPTION_VALUES }),
    instruction: text("instruction"),
    status: text("status", { enum: DRAFT_STATUS_VALUES })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    /** An error code only, never text from the model or the post. */
    error: text("error"),
    /** The model's plan: what the client needs, and the one fact it cites. */
    problem: text("problem"),
    citedFact: text("cited_fact"),
    applyFollowed: boolean("apply_followed"),
    comment: text("comment"),
    dm: text("dm"),
    /** core `Evidence`: the facts the draft was written from. */
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    styleTags: text("style_tags").array(),
    warning: boolean("warning").notNull().default(false),
    /** core `Problem[]`: what the validators found. */
    problems: jsonb("problems").$type<{ code: string; detail?: string }[]>(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costMicros: integer("cost_micros"),
    timings: jsonb("timings").$type<Record<string, number>>(),
    /** Credits reserved for this draft (0 once refunded). */
    credits: integer("credits").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // A failed version frees its number: a retry of v1 (or a rewrite) takes the same number
    // as a new row, and failed rows don't count toward MAX_VERSIONS.
    uniqueIndex("drafts_user_match_version_idx")
      .on(t.userId, t.matchId, t.version)
      .where(sql`${t.status} <> 'failed'`),
    uniqueIndex("drafts_user_idempotency_idx")
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    check("drafts_version_check", sql`${t.version} between 1 and 5`),
    check(
      "drafts_instruction_check",
      sql`${t.instruction} is null or char_length(${t.instruction}) <= 200`,
    ),
    check("drafts_credits_check", sql`${t.credits} >= 0`),
    check(
      "drafts_kind_check",
      sql`${t.kind} in (${sqlList(DRAFT_KIND_VALUES)})`,
    ),
    check(
      "drafts_option_check",
      sql`${t.option} is null or ${t.option} in (${sqlList(REWRITE_OPTION_VALUES)})`,
    ),
    check(
      "drafts_status_check",
      sql`${t.status} in (${sqlList(DRAFT_STATUS_VALUES)})`,
    ),
    // The worker's claim: pending drafts that are due, and running ones to requeue.
    index("drafts_queue_idx")
      .on(t.status, t.runAfter)
      .where(sql`${t.status} in ('pending', 'running')`),
    index("drafts_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export type Draft = typeof drafts.$inferSelect;

/** One row per user: credits left in the current plan period. */
export const creditBalances = pgTable(
  "credit_balances",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    plan: text("plan", { enum: PLANS }).notNull(),
    balance: integer("balance").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("credit_balances_balance_check", sql`${t.balance} >= 0`),
    check("credit_balances_plan_check", sql`${t.plan} in (${sqlList(PLANS)})`),
  ],
);

/** Every change to a balance. */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: v7Id(),
    userId: userId(),
    delta: integer("delta").notNull(),
    reason: text("reason", { enum: LEDGER_REASON_VALUES }).notNull(),
    draftId: uuid("draft_id").references(() => drafts.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "credit_ledger_reason_check",
      sql`${t.reason} in (${sqlList(LEDGER_REASON_VALUES)})`,
    ),
    index("credit_ledger_user_created_idx").on(t.userId, t.createdAt),
    // A draft is refunded at most once (refundCredits relies on this).
    uniqueIndex("credit_ledger_refund_once_idx")
      .on(t.draftId)
      .where(sql`${t.reason} = 'refund'`),
  ],
);

/** What the user actually sent (the tracker). One per post and kind. */
export const replies = pgTable(
  "replies",
  {
    id: v7Id(),
    userId: userId(),
    // Kept (as null) if the match or draft is deleted: a sent reply is history.
    matchId: uuid("match_id").references(() => matches.id, {
      onDelete: "set null",
    }),
    jobPostId: uuid("job_post_id")
      .notNull()
      .references(() => jobPosts.id),
    draftId: uuid("draft_id").references(() => drafts.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: REPLY_KIND_VALUES }).notNull(),
    sentText: text("sent_text").notNull(),
    /** 0-1: how much of the draft the user changed; null when there was no draft. */
    editRatio: real("edit_ratio"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: REPLY_STATUS_VALUES })
      .notNull()
      .default("sent"),
    remindAt: timestamp("remind_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("replies_user_post_kind_unique").on(t.userId, t.jobPostId, t.kind),
    check("replies_sent_text_check", sql`char_length(${t.sentText}) <= 10000`),
    check(
      "replies_kind_check",
      sql`${t.kind} in (${sqlList(REPLY_KIND_VALUES)})`,
    ),
    check(
      "replies_status_check",
      sql`${t.status} in (${sqlList(REPLY_STATUS_VALUES)})`,
    ),
    index("replies_user_status_sent_idx").on(t.userId, t.status, t.sentAt),
  ],
);

export type Reply = typeof replies.$inferSelect;

/**
 * Every time the user marks a reply as sent (rule 3: store everything). `replies` holds the
 * latest send per post and kind; this keeps each one, append-only.
 */
export const replySends = pgTable(
  "reply_sends",
  {
    id: v7Id(),
    replyId: uuid("reply_id")
      .notNull()
      .references(() => replies.id, { onDelete: "cascade" }),
    userId: userId(),
    draftId: uuid("draft_id").references(() => drafts.id, {
      onDelete: "set null",
    }),
    sentText: text("sent_text").notNull(),
    editRatio: real("edit_ratio"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "reply_sends_sent_text_check",
      sql`char_length(${t.sentText}) <= 10000`,
    ),
    index("reply_sends_reply_sent_idx").on(t.replyId, t.sentAt),
  ],
);

export type ReplySend = typeof replySends.$inferSelect;

/** Every reported outcome of a reply (rule 3: store everything). */
export const outcomes = pgTable(
  "outcomes",
  {
    id: v7Id(),
    replyId: uuid("reply_id")
      .notNull()
      .references(() => replies.id, { onDelete: "cascade" }),
    userId: userId(),
    type: text("type", { enum: OUTCOME_TYPE_VALUES }).notNull(),
    /** In minor units of `currency` (cents, pence, paise). */
    agreedRateMinor: integer("agreed_rate_minor"),
    currency: text("currency"),
    reportedAt: timestamp("reported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "outcomes_type_check",
      sql`${t.type} in (${sqlList(OUTCOME_TYPE_VALUES)})`,
    ),
    check(
      "outcomes_rate_check",
      sql`${t.agreedRateMinor} is null or ${t.agreedRateMinor} >= 0`,
    ),
    index("outcomes_reply_idx").on(t.replyId),
  ],
);

/** What we've learned about how a user writes, from their edits. */
export const voiceProfiles = pgTable(
  "voice_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    notes: text("notes"),
    previousNotes: text("previous_notes"),
    /** core `VoiceStats`. */
    stats: jsonb("stats").$type<Record<string, unknown>>(),
    sendsCounted: integer("sends_counted").notNull().default(0),
    sendsSinceUpdate: integer("sends_since_update").notNull().default(0),
    version: integer("version").notNull().default(0),
    bestReplyIds: uuid("best_reply_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    updateStatus: text("update_status", { enum: VOICE_UPDATE_STATUS_VALUES })
      .notNull()
      .default("idle"),
    updateRunAfter: timestamp("update_run_after", { withTimezone: true }),
    updateLockedAt: timestamp("update_locked_at", { withTimezone: true }),
    /** The UTC day `updates_today` counts for. */
    updatesDay: date("updates_day", { mode: "string" }),
    updatesToday: integer("updates_today").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "voice_profiles_notes_check",
      sql`${t.notes} is null or char_length(${t.notes}) <= 600`,
    ),
    check(
      "voice_profiles_best_replies_check",
      sql`cardinality(${t.bestReplyIds}) <= 2`,
    ),
    check(
      "voice_profiles_update_status_check",
      sql`${t.updateStatus} in (${sqlList(VOICE_UPDATE_STATUS_VALUES)})`,
    ),
    index("voice_profiles_queue_idx")
      .on(t.updateStatus, t.updateRunAfter)
      .where(sql`${t.updateStatus} <> 'idle'`),
  ],
);

export type VoiceProfile = typeof voiceProfiles.$inferSelect;

/** Example replies shown to the model. The id is a stable key like `webdev-dm-1`. */
export const draftExamples = pgTable(
  "draft_examples",
  {
    id: text("id").primaryKey(),
    /** A job type id from the taxonomy, or `general`. */
    jobType: text("job_type").notNull(),
    channel: text("channel", { enum: REPLY_KIND_VALUES }).notNull(),
    style: text("style").notNull(),
    postExcerpt: text("post_excerpt").notNull(),
    text: text("text").notNull(),
    source: text("source", { enum: EXAMPLE_SOURCE_VALUES }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    check(
      "draft_examples_channel_check",
      sql`${t.channel} in (${sqlList(REPLY_KIND_VALUES)})`,
    ),
    check(
      "draft_examples_source_check",
      sql`${t.source} in (${sqlList(EXAMPLE_SOURCE_VALUES)})`,
    ),
  ],
);

/** Drafts worth a human look when building the eval set. */
export const draftEvalCandidates = pgTable(
  "draft_eval_candidates",
  {
    id: v7Id(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    reason: text("reason", { enum: EVAL_CANDIDATE_REASON_VALUES }).notNull(),
    reviewStatus: text("review_status", { enum: EVAL_REVIEW_STATUS_VALUES })
      .notNull()
      .default("pending"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("draft_eval_candidates_draft_reason_unique").on(t.draftId, t.reason),
    check(
      "draft_eval_candidates_reason_check",
      sql`${t.reason} in (${sqlList(EVAL_CANDIDATE_REASON_VALUES)})`,
    ),
    check(
      "draft_eval_candidates_review_status_check",
      sql`${t.reviewStatus} in (${sqlList(EVAL_REVIEW_STATUS_VALUES)})`,
    ),
  ],
);

/** A thumbs-down on a draft, with an optional reason. */
export const draftFeedback = pgTable(
  "draft_feedback",
  {
    id: v7Id(),
    userId: userId(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("draft_feedback_user_draft_unique").on(t.userId, t.draftId),
    check(
      "draft_feedback_reason_check",
      sql`${t.reason} is null or char_length(${t.reason}) <= 300`,
    ),
  ],
);

/**
 * The alert queue: one row per (match, channel) waiting to be sent. Deleted when sent;
 * failed rows are kept 30 days for debugging.
 */
export const alertDeliveries = pgTable(
  "alert_deliveries",
  {
    id: v7Id(),
    userId: userId(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: DELIVERY_CHANNELS }).notNull(),
    status: text("status", { enum: DELIVERY_STATUSES })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    /** An error code only, never message text. */
    errorCode: text("error_code"),
    providerMessageId: text("provider_message_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("alert_deliveries_match_channel_unique").on(t.matchId, t.channel),
    check(
      "alert_deliveries_channel_check",
      sql`${t.channel} in (${sqlList(DELIVERY_CHANNELS)})`,
    ),
    check(
      "alert_deliveries_status_check",
      sql`${t.status} in (${sqlList(DELIVERY_STATUSES)})`,
    ),
    check("alert_deliveries_attempts_check", sql`${t.attempts} >= 0`),
    index("alert_deliveries_due_idx")
      .on(t.channel, t.runAfter)
      .where(sql`${t.status} = 'pending'`),
    index("alert_deliveries_sending_idx")
      .on(t.lockedAt)
      .where(sql`${t.status} = 'sending'`),
    index("alert_deliveries_user_idx").on(t.userId),
  ],
);

/** One-time links that connect a Telegram chat to a user. Only the sha256 is stored. */
export const telegramLinkTokens = pgTable(
  "telegram_link_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: userId(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "telegram_link_tokens_hash_check",
      sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    index("telegram_link_tokens_user_idx").on(t.userId),
  ],
);
