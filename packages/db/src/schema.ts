import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
export const SUBREDDIT_SOURCES = ["auto", "user"] as const;
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

export const subreddits = pgTable(
  "subreddits",
  {
    name: text("name").primaryKey(),
    categories: text("categories").array().notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [check("subreddits_name_check", sql`${t.name} ~ '^[a-z0-9_]{2,21}$'`)],
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
    blockedWords: text("blocked_words")
      .array()
      .notNull()
      .default(emptyTextArray),
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
export const LLM_OUTCOMES = ["ok", "timeout", "error", "invalid_output"] as const;

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
    status: text("status", { enum: IMPORT_STATUSES }).notNull().default("queued"),
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
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    importJobId: uuid("import_job_id").references(() => importJobs.id, {
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
