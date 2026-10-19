CREATE TABLE "match_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_events_event_check" CHECK ("match_events"."event" in ('new', 'seen', 'saved', 'dismissed', 'replied'))
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"job_post_id" uuid NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"rule_score" integer NOT NULL,
	"broad" boolean NOT NULL,
	"features" jsonb NOT NULL,
	"rule_reason" text NOT NULL,
	"ai_status" text NOT NULL,
	"ai_attempts" integer DEFAULT 0 NOT NULL,
	"ai_run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"ai_locked_at" timestamp with time zone,
	"ai_error" text,
	"ai_score" integer,
	"ai_reason" text,
	"ai_concerns" text[] DEFAULT '{}'::text[] NOT NULL,
	"ai_model" text,
	"ai_scored_at" timestamp with time zone,
	"best_project_id" uuid,
	"best_role_id" uuid,
	"score" integer NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"profile_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_user_post_unique" UNIQUE("user_id","job_post_id"),
	CONSTRAINT "matches_rule_score_check" CHECK ("matches"."rule_score" between 0 and 100),
	CONSTRAINT "matches_score_check" CHECK ("matches"."score" between 0 and 100),
	CONSTRAINT "matches_ai_score_check" CHECK ("matches"."ai_score" is null or "matches"."ai_score" between 0 and 100),
	CONSTRAINT "matches_rule_reason_check" CHECK (char_length("matches"."rule_reason") <= 160),
	CONSTRAINT "matches_ai_reason_check" CHECK ("matches"."ai_reason" is null or char_length("matches"."ai_reason") <= 160),
	CONSTRAINT "matches_ai_concerns_check" CHECK (cardinality("matches"."ai_concerns") <= 3),
	CONSTRAINT "matches_ai_status_check" CHECK ("matches"."ai_status" in ('not_needed', 'pending', 'running', 'done', 'failed', 'capped')),
	CONSTRAINT "matches_status_check" CHECK ("matches"."status" in ('new', 'seen', 'saved', 'dismissed', 'replied')),
	CONSTRAINT "matches_broad_ai_check" CHECK (not "matches"."broad" or "matches"."ai_status" = 'not_needed'),
	CONSTRAINT "matches_ai_attempts_check" CHECK ("matches"."ai_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rescore_usage" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"used" integer NOT NULL,
	CONSTRAINT "rescore_usage_user_id_day_pk" PRIMARY KEY("user_id","day"),
	CONSTRAINT "rescore_usage_used_check" CHECK ("rescore_usage"."used" >= 0)
);
--> statement-breakpoint
ALTER TABLE "job_posts" ADD COLUMN "match_status" text;--> statement-breakpoint
ALTER TABLE "job_posts" ADD COLUMN "match_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_posts" ADD COLUMN "match_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "plan" text DEFAULT 'trial' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "include_unpaid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "rematch_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "profile_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_job_post_id_job_posts_id_fk" FOREIGN KEY ("job_post_id") REFERENCES "public"."job_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_best_project_id_profile_projects_id_fk" FOREIGN KEY ("best_project_id") REFERENCES "public"."profile_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_best_role_id_profile_experience_id_fk" FOREIGN KEY ("best_role_id") REFERENCES "public"."profile_experience"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescore_usage" ADD CONSTRAINT "rescore_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_events_user_created_idx" ON "match_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "matches_user_status_idx" ON "matches" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "matches_ai_queue_idx" ON "matches" USING btree ("rule_score" DESC NULLS LAST,"created_at" DESC NULLS LAST) WHERE "matches"."ai_status" = 'pending';--> statement-breakpoint
CREATE INDEX "matches_ai_running_idx" ON "matches" USING btree ("ai_locked_at") WHERE "matches"."ai_status" = 'running';--> statement-breakpoint
CREATE INDEX "matches_job_post_idx" ON "matches" USING btree ("job_post_id");--> statement-breakpoint
CREATE INDEX "matches_feed_idx" ON "matches" USING btree ("user_id","posted_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "matches"."status" <> 'dismissed';--> statement-breakpoint
CREATE INDEX "job_posts_match_queue_idx" ON "job_posts" USING btree ("posted_at" DESC NULLS LAST) WHERE "job_posts"."match_status" = 'pending';--> statement-breakpoint
CREATE INDEX "job_posts_match_running_idx" ON "job_posts" USING btree ("match_locked_at") WHERE "job_posts"."match_status" = 'running';--> statement-breakpoint
CREATE INDEX "profiles_rematch_idx" ON "profiles" USING btree ("rematch_since") WHERE "profiles"."rematch_since" is not null;--> statement-breakpoint
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_match_status_check" CHECK ("job_posts"."match_status" is null or "job_posts"."match_status" in ('pending', 'running', 'done', 'skipped'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_plan_check" CHECK ("profiles"."plan" in ('trial', 'standard', 'max'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_profile_version_check" CHECK ("profiles"."profile_version" >= 1);