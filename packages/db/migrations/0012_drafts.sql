CREATE TABLE "credit_balances" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"balance" integer NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_balances_balance_check" CHECK ("credit_balances"."balance" >= 0),
	CONSTRAINT "credit_balances_plan_check" CHECK ("credit_balances"."plan" in ('trial', 'standard', 'max'))
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"draft_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_reason_check" CHECK ("credit_ledger"."reason" in ('grant', 'reserve', 'refund', 'expire', 'adjust'))
);
--> statement-breakpoint
CREATE TABLE "draft_eval_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"draft_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_eval_candidates_draft_reason_unique" UNIQUE("draft_id","reason"),
	CONSTRAINT "draft_eval_candidates_reason_check" CHECK ("draft_eval_candidates"."reason" in ('validator_failed_twice', 'heavy_edit', 'many_rewrites', 'thumbs_down')),
	CONSTRAINT "draft_eval_candidates_review_status_check" CHECK ("draft_eval_candidates"."review_status" in ('pending', 'added', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "draft_examples" (
	"id" text PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"channel" text NOT NULL,
	"style" text NOT NULL,
	"post_excerpt" text NOT NULL,
	"text" text NOT NULL,
	"source" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "draft_examples_channel_check" CHECK ("draft_examples"."channel" in ('comment', 'dm')),
	CONSTRAINT "draft_examples_source_check" CHECK ("draft_examples"."source" in ('handwritten', 'winning'))
);
--> statement-breakpoint
CREATE TABLE "draft_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_feedback_user_draft_unique" UNIQUE("user_id","draft_id"),
	CONSTRAINT "draft_feedback_reason_check" CHECK ("draft_feedback"."reason" is null or char_length("draft_feedback"."reason") <= 300)
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"job_post_id" uuid NOT NULL,
	"version" smallint NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"option" text,
	"instruction" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"error" text,
	"problem" text,
	"cited_fact" text,
	"apply_followed" boolean,
	"comment" text,
	"dm" text,
	"evidence" jsonb,
	"style_tags" text[],
	"warning" boolean DEFAULT false NOT NULL,
	"problems" jsonb,
	"model" text,
	"prompt_version" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_micros" integer,
	"timings" jsonb,
	"credits" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "drafts_user_match_version_unique" UNIQUE("user_id","match_id","version"),
	CONSTRAINT "drafts_version_check" CHECK ("drafts"."version" between 1 and 5),
	CONSTRAINT "drafts_instruction_check" CHECK ("drafts"."instruction" is null or char_length("drafts"."instruction") <= 200),
	CONSTRAINT "drafts_credits_check" CHECK ("drafts"."credits" >= 0),
	CONSTRAINT "drafts_kind_check" CHECK ("drafts"."kind" in ('draft', 'rewrite')),
	CONSTRAINT "drafts_option_check" CHECK ("drafts"."option" is null or "drafts"."option" in ('shorter', 'casual', 'formal', 'different_project', 'custom')),
	CONSTRAINT "drafts_status_check" CHECK ("drafts"."status" in ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reply_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"agreed_rate_minor" integer,
	"currency" text,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcomes_type_check" CHECK ("outcomes"."type" in ('replied', 'hired', 'lost', 'no_reply', 'ghosted', 'unpaid')),
	CONSTRAINT "outcomes_rate_check" CHECK ("outcomes"."agreed_rate_minor" is null or "outcomes"."agreed_rate_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"match_id" uuid,
	"job_post_id" uuid NOT NULL,
	"draft_id" uuid,
	"kind" text NOT NULL,
	"sent_text" text NOT NULL,
	"edit_ratio" real,
	"sent_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"remind_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replies_user_post_kind_unique" UNIQUE("user_id","job_post_id","kind"),
	CONSTRAINT "replies_sent_text_check" CHECK (char_length("replies"."sent_text") <= 10000),
	CONSTRAINT "replies_kind_check" CHECK ("replies"."kind" in ('comment', 'dm')),
	CONSTRAINT "replies_status_check" CHECK ("replies"."status" in ('sent', 'replied', 'hired', 'lost', 'no_reply', 'ghosted'))
);
--> statement-breakpoint
CREATE TABLE "voice_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"notes" text,
	"previous_notes" text,
	"stats" jsonb,
	"sends_counted" integer DEFAULT 0 NOT NULL,
	"sends_since_update" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"best_reply_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"update_status" text DEFAULT 'idle' NOT NULL,
	"update_run_after" timestamp with time zone,
	"update_locked_at" timestamp with time zone,
	"updates_day" date,
	"updates_today" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_profiles_notes_check" CHECK ("voice_profiles"."notes" is null or char_length("voice_profiles"."notes") <= 600),
	CONSTRAINT "voice_profiles_best_replies_check" CHECK (cardinality("voice_profiles"."best_reply_ids") <= 2),
	CONSTRAINT "voice_profiles_update_status_check" CHECK ("voice_profiles"."update_status" in ('idle', 'pending', 'running'))
);
--> statement-breakpoint
ALTER TABLE "job_post_analyses" ADD COLUMN "apply_instructions" text;--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_eval_candidates" ADD CONSTRAINT "draft_eval_candidates_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_feedback" ADD CONSTRAINT "draft_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_feedback" ADD CONSTRAINT "draft_feedback_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_job_post_id_job_posts_id_fk" FOREIGN KEY ("job_post_id") REFERENCES "public"."job_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_parent_id_drafts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_reply_id_replies_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."replies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_job_post_id_job_posts_id_fk" FOREIGN KEY ("job_post_id") REFERENCES "public"."job_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_user_created_idx" ON "credit_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_user_idempotency_idx" ON "drafts" USING btree ("user_id","idempotency_key") WHERE "drafts"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "drafts_queue_idx" ON "drafts" USING btree ("status","run_after") WHERE "drafts"."status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "drafts_user_created_idx" ON "drafts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "outcomes_reply_idx" ON "outcomes" USING btree ("reply_id");--> statement-breakpoint
CREATE INDEX "replies_user_status_sent_idx" ON "replies" USING btree ("user_id","status","sent_at");--> statement-breakpoint
CREATE INDEX "voice_profiles_queue_idx" ON "voice_profiles" USING btree ("update_status","update_run_after") WHERE "voice_profiles"."update_status" <> 'idle';--> statement-breakpoint
ALTER TABLE "job_post_analyses" ADD CONSTRAINT "job_post_analyses_apply_instructions_check" CHECK ("job_post_analyses"."apply_instructions" is null or char_length("job_post_analyses"."apply_instructions") <= 300);