CREATE TABLE "feed_polls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"feed_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"http_status" integer,
	"entries" integer DEFAULT 0 NOT NULL,
	"new_posts" integer DEFAULT 0 NOT NULL,
	"page" integer DEFAULT 0 NOT NULL,
	"rate_limit_remaining" real,
	"rate_limit_reset" integer,
	"error_code" text
);
--> statement-breakpoint
CREATE TABLE "feeds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"subreddits" text[],
	"query" text,
	"interval_seconds" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_polled_at" timestamp with time zone,
	"next_poll_at" timestamp with time zone DEFAULT now() NOT NULL,
	"catch_up_after" text,
	"catch_up_pages_left" integer DEFAULT 0 NOT NULL,
	"catch_up_until" timestamp with time zone,
	"consecutive_errors" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feeds_kind_check" CHECK ("feeds"."kind" in ('subreddits', 'search')),
	CONSTRAINT "feeds_interval_check" CHECK ("feeds"."interval_seconds" >= 60),
	CONSTRAINT "feeds_status_check" CHECK ("feeds"."status" in ('active', 'retired')),
	CONSTRAINT "feeds_shape_check" CHECK (("feeds"."kind" = 'subreddits' and cardinality("feeds"."subreddits") > 0 and "feeds"."query" is null)
        or ("feeds"."kind" = 'search' and "feeds"."query" is not null and "feeds"."subreddits" is null))
);
--> statement-breakpoint
CREATE TABLE "job_post_analyses" (
	"job_post_id" uuid PRIMARY KEY NOT NULL,
	"pipeline_version" text NOT NULL,
	"kind" text NOT NULL,
	"employment_type" text NOT NULL,
	"pay_type" text NOT NULL,
	"categories" text[] NOT NULL,
	"skill_ids" text[] NOT NULL,
	"budget_min" numeric(12, 2),
	"budget_max" numeric(12, 2),
	"currency" text,
	"budget_unit" text,
	"remote" text NOT NULL,
	"location" text,
	"deadline" date,
	"red_flags" text[] NOT NULL,
	"summary" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_post_analyses_kind_check" CHECK ("job_post_analyses"."kind" in ('hiring', 'for_hire', 'other')),
	CONSTRAINT "job_post_analyses_employment_check" CHECK ("job_post_analyses"."employment_type" in ('freelance', 'contract', 'part_time', 'full_time', 'unknown')),
	CONSTRAINT "job_post_analyses_pay_check" CHECK ("job_post_analyses"."pay_type" in ('paid', 'commission_only', 'revshare', 'unpaid', 'unknown')),
	CONSTRAINT "job_post_analyses_remote_check" CHECK ("job_post_analyses"."remote" in ('remote', 'onsite', 'hybrid', 'unknown')),
	CONSTRAINT "job_post_analyses_budget_unit_check" CHECK ("job_post_analyses"."budget_unit" is null or "job_post_analyses"."budget_unit" in ('fixed', 'hour', 'day', 'week', 'month', 'per_item')),
	CONSTRAINT "job_post_analyses_budget_check" CHECK ("job_post_analyses"."budget_min" is null or "job_post_analyses"."budget_max" is null or "job_post_analyses"."budget_min" <= "job_post_analyses"."budget_max"),
	CONSTRAINT "job_post_analyses_currency_check" CHECK ("job_post_analyses"."currency" is null or "job_post_analyses"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "job_posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"fetched_via" text NOT NULL,
	"community" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"author" text,
	"posted_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_seen_feed_id" uuid,
	"pre_kind" text NOT NULL,
	"analysis_status" text DEFAULT 'pending' NOT NULL,
	"analysis_attempts" integer DEFAULT 0 NOT NULL,
	"analysis_run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"analysis_locked_at" timestamp with time zone,
	"analysis_error" text,
	CONSTRAINT "job_posts_source_external_unique" UNIQUE("source","external_id"),
	CONSTRAINT "job_posts_source_check" CHECK ("job_posts"."source" in ('reddit')),
	CONSTRAINT "job_posts_fetched_via_check" CHECK ("job_posts"."fetched_via" in ('rss', 'api')),
	CONSTRAINT "job_posts_pre_kind_check" CHECK ("job_posts"."pre_kind" in ('hiring', 'for_hire', 'unknown')),
	CONSTRAINT "job_posts_analysis_status_check" CHECK ("job_posts"."analysis_status" in ('pending', 'running', 'done', 'skipped', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "llm_usage" ADD COLUMN "job_post_id" uuid;--> statement-breakpoint
ALTER TABLE "subreddits" ADD COLUMN "dormant_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subreddits" ADD COLUMN "last_polled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subreddits" ADD COLUMN "unreachable_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subreddits" ADD COLUMN "unreachable_reason" text;--> statement-breakpoint
ALTER TABLE "feed_polls" ADD CONSTRAINT "feed_polls_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_post_analyses" ADD CONSTRAINT "job_post_analyses_job_post_id_job_posts_id_fk" FOREIGN KEY ("job_post_id") REFERENCES "public"."job_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_first_seen_feed_id_feeds_id_fk" FOREIGN KEY ("first_seen_feed_id") REFERENCES "public"."feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_polls_started_idx" ON "feed_polls" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "feeds_due_idx" ON "feeds" USING btree ("next_poll_at") WHERE "feeds"."status" = 'active';--> statement-breakpoint
CREATE INDEX "job_post_analyses_kind_idx" ON "job_post_analyses" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "job_posts_analysis_queue_idx" ON "job_posts" USING btree ("analysis_run_after") WHERE "job_posts"."analysis_status" = 'pending';--> statement-breakpoint
CREATE INDEX "job_posts_analysis_running_idx" ON "job_posts" USING btree ("analysis_locked_at") WHERE "job_posts"."analysis_status" = 'running';--> statement-breakpoint
CREATE INDEX "job_posts_community_posted_idx" ON "job_posts" USING btree ("community","posted_at");--> statement-breakpoint
CREATE INDEX "job_posts_posted_idx" ON "job_posts" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "job_posts_author_idx" ON "job_posts" USING btree ("author");--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_job_post_id_job_posts_id_fk" FOREIGN KEY ("job_post_id") REFERENCES "public"."job_posts"("id") ON DELETE set null ON UPDATE no action;