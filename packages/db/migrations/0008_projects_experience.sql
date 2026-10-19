CREATE TABLE "profile_experience" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"skill_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organisation" text,
	"organisation_description" text NOT NULL,
	"employment_type" text NOT NULL,
	"start_year" smallint,
	"start_month" smallint,
	"end_year" smallint,
	"end_month" smallint,
	"is_current" boolean DEFAULT false NOT NULL,
	"highlights" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "profile_experience_position_check" CHECK ("profile_experience"."position" >= 0 and "profile_experience"."position" < 6),
	CONSTRAINT "profile_experience_title_check" CHECK (char_length("profile_experience"."title") between 1 and 80),
	CONSTRAINT "profile_experience_summary_check" CHECK (char_length("profile_experience"."summary") <= 160),
	CONSTRAINT "profile_experience_skill_ids_check" CHECK (cardinality("profile_experience"."skill_ids") <= 10),
	CONSTRAINT "profile_experience_categories_check" CHECK (cardinality("profile_experience"."categories") <= 2),
	CONSTRAINT "profile_experience_domains_check" CHECK (cardinality("profile_experience"."domains") <= 4),
	CONSTRAINT "profile_experience_source_check" CHECK ("profile_experience"."source" in ('resume', 'manual')),
	CONSTRAINT "profile_experience_organisation_check" CHECK (char_length("profile_experience"."organisation") <= 80),
	CONSTRAINT "profile_experience_organisation_description_check" CHECK (char_length("profile_experience"."organisation_description") <= 60),
	CONSTRAINT "profile_experience_employment_type_check" CHECK ("profile_experience"."employment_type" in ('full_time', 'part_time', 'freelance', 'contract', 'internship', 'unknown')),
	CONSTRAINT "profile_experience_free_organisation_check" CHECK ("profile_experience"."employment_type" not in ('freelance', 'contract') or "profile_experience"."organisation" is null),
	CONSTRAINT "profile_experience_start_check" CHECK (("profile_experience"."start_year" is null or "profile_experience"."start_year" between 1950 and 2100)
        and ("profile_experience"."start_month" is null or ("profile_experience"."start_year" is not null and "profile_experience"."start_month" between 1 and 12))),
	CONSTRAINT "profile_experience_end_check" CHECK (("profile_experience"."end_year" is null or "profile_experience"."end_year" between 1950 and 2100)
        and ("profile_experience"."end_month" is null or ("profile_experience"."end_year" is not null and "profile_experience"."end_month" between 1 and 12))),
	CONSTRAINT "profile_experience_current_check" CHECK (not "profile_experience"."is_current" or ("profile_experience"."end_year" is null and "profile_experience"."end_month" is null)),
	CONSTRAINT "profile_experience_highlights_check" CHECK (cardinality("profile_experience"."highlights") <= 4)
);
--> statement-breakpoint
CREATE TABLE "profile_projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"skill_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"outcomes" text[] DEFAULT '{}'::text[] NOT NULL,
	"links" text[] DEFAULT '{}'::text[] NOT NULL,
	"year" smallint,
	CONSTRAINT "profile_projects_position_check" CHECK ("profile_projects"."position" >= 0 and "profile_projects"."position" < 8),
	CONSTRAINT "profile_projects_title_check" CHECK (char_length("profile_projects"."title") between 1 and 80),
	CONSTRAINT "profile_projects_summary_check" CHECK (char_length("profile_projects"."summary") <= 160),
	CONSTRAINT "profile_projects_skill_ids_check" CHECK (cardinality("profile_projects"."skill_ids") <= 10),
	CONSTRAINT "profile_projects_categories_check" CHECK (cardinality("profile_projects"."categories") <= 2),
	CONSTRAINT "profile_projects_domains_check" CHECK (cardinality("profile_projects"."domains") <= 4),
	CONSTRAINT "profile_projects_source_check" CHECK ("profile_projects"."source" in ('resume', 'manual')),
	CONSTRAINT "profile_projects_role_check" CHECK ("profile_projects"."role" in ('solo', 'lead', 'team', 'unknown')),
	CONSTRAINT "profile_projects_kind_check" CHECK ("profile_projects"."kind" in ('client', 'employer', 'personal', 'open_source', 'academic', 'hackathon', 'unknown')),
	CONSTRAINT "profile_projects_outcomes_check" CHECK (cardinality("profile_projects"."outcomes") <= 3),
	CONSTRAINT "profile_projects_links_check" CHECK (cardinality("profile_projects"."links") <= 3),
	CONSTRAINT "profile_projects_year_check" CHECK ("profile_projects"."year" is null or "profile_projects"."year" between 1950 and 2100)
);
--> statement-breakpoint
ALTER TABLE "onboarding_steps" DROP CONSTRAINT "onboarding_steps_step_check";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "mention_employers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_experience" ADD CONSTRAINT "profile_experience_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_projects" ADD CONSTRAINT "profile_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_experience_user_position_idx" ON "profile_experience" USING btree ("user_id","position");--> statement-breakpoint
CREATE INDEX "profile_projects_user_position_idx" ON "profile_projects" USING btree ("user_id","position");--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_step_check" CHECK ("onboarding_steps"."step" in ('import', 'basics', 'skills', 'work', 'rates'));