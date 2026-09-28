CREATE TABLE "alert_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_channels_user_kind_unique" UNIQUE("user_id","kind"),
	CONSTRAINT "alert_channels_kind_check" CHECK ("alert_channels"."kind" in ('email', 'telegram'))
);
--> statement-breakpoint
CREATE TABLE "custom_skills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"level" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_skills_user_name_unique" UNIQUE("user_id","name_normalized"),
	CONSTRAINT "custom_skills_level_check" CHECK ("custom_skills"."level" in ('core', 'secondary')),
	CONSTRAINT "custom_skills_source_check" CHECK ("custom_skills"."source" in ('manual', 'resume', 'github'))
);
--> statement-breakpoint
CREATE TABLE "onboarding_steps" (
	"user_id" uuid NOT NULL,
	"step" text NOT NULL,
	"status" text NOT NULL,
	"data" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_steps_user_id_step_pk" PRIMARY KEY("user_id","step"),
	CONSTRAINT "onboarding_steps_step_check" CHECK ("onboarding_steps"."step" in ('import', 'basics', 'skills', 'rates')),
	CONSTRAINT "onboarding_steps_status_check" CHECK ("onboarding_steps"."status" in ('draft', 'completed')),
	CONSTRAINT "onboarding_steps_data_size_check" CHECK (pg_column_size("onboarding_steps"."data") <= 65536)
);
--> statement-breakpoint
CREATE TABLE "profile_skills" (
	"user_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"level" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_skills_user_id_skill_id_pk" PRIMARY KEY("user_id","skill_id"),
	CONSTRAINT "profile_skills_level_check" CHECK ("profile_skills"."level" in ('core', 'secondary')),
	CONSTRAINT "profile_skills_source_check" CHECK ("profile_skills"."source" in ('manual', 'resume', 'github'))
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"categories" text[] NOT NULL,
	"experience_level" text NOT NULL,
	"country" text NOT NULL,
	"time_zone" text NOT NULL,
	"github_username" text,
	"min_rate_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"rate_type" text NOT NULL,
	"remote_only" boolean NOT NULL,
	"blocked_words" text[] DEFAULT '{}'::text[] NOT NULL,
	"onboarded_at" timestamp with time zone NOT NULL,
	"trial_ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_experience_level_check" CHECK ("profiles"."experience_level" in ('beginner', 'intermediate', 'experienced')),
	CONSTRAINT "profiles_currency_check" CHECK ("profiles"."currency" in ('USD', 'GBP', 'EUR', 'INR')),
	CONSTRAINT "profiles_rate_type_check" CHECK ("profiles"."rate_type" in ('hourly', 'fixed', 'either')),
	CONSTRAINT "profiles_min_rate_check" CHECK ("profiles"."min_rate_minor" between 0 and 10000000),
	CONSTRAINT "profiles_categories_check" CHECK (cardinality("profiles"."categories") between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"retired" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subreddits" (
	"name" text PRIMARY KEY NOT NULL,
	"categories" text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "subreddits_name_check" CHECK ("subreddits"."name" ~ '^[a-z0-9_]{2,21}$')
);
--> statement-breakpoint
CREATE TABLE "user_subreddits" (
	"user_id" uuid NOT NULL,
	"subreddit" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_subreddits_user_id_subreddit_pk" PRIMARY KEY("user_id","subreddit"),
	CONSTRAINT "user_subreddits_source_check" CHECK ("user_subreddits"."source" in ('auto', 'user'))
);
--> statement-breakpoint
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_skills" ADD CONSTRAINT "custom_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_subreddits" ADD CONSTRAINT "user_subreddits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;