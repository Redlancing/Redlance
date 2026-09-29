CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'queued' NOT NULL,
	"file_bytes" "bytea",
	"file_type" text,
	"input" jsonb NOT NULL,
	"source_text" text,
	"content_hash" text,
	"pipeline_version" text,
	"result" jsonb,
	"error_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "import_jobs_kind_check" CHECK ("import_jobs"."kind" in ('resume', 'github')),
	CONSTRAINT "import_jobs_status_check" CHECK ("import_jobs"."status" in ('queued', 'running', 'done', 'failed')),
	CONSTRAINT "import_jobs_stage_check" CHECK ("import_jobs"."stage" in ('queued', 'reading', 'analysing', 'checking', 'done', 'failed')),
	CONSTRAINT "import_jobs_file_type_check" CHECK ("import_jobs"."file_type" is null or "import_jobs"."file_type" in ('pdf', 'docx'))
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"import_job_id" uuid,
	"task" text NOT NULL,
	"step" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_micros" bigint NOT NULL,
	"latency_ms" integer NOT NULL,
	"attempt" integer NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_usage_outcome_check" CHECK ("llm_usage"."outcome" in ('ok', 'timeout', 'error', 'invalid_output'))
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_jobs_queue_idx" ON "import_jobs" USING btree ("status","run_after") WHERE "import_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "import_jobs_user_idx" ON "import_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "import_jobs_cache_idx" ON "import_jobs" USING btree ("content_hash","pipeline_version") WHERE "import_jobs"."status" = 'done';--> statement-breakpoint
CREATE INDEX "llm_usage_created_idx" ON "llm_usage" USING btree ("created_at");