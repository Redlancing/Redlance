-- Users are no longer connected to subreddits automatically (docs/ingestion/plan.md): only
-- subreddits a paying user adds will live here. Only local dev data exists, so drop the rest.
ALTER TABLE "user_subreddits" DROP CONSTRAINT "user_subreddits_source_check";--> statement-breakpoint
DELETE FROM "user_subreddits" WHERE "source" <> 'user';--> statement-breakpoint
-- Existing rows get values from their old columns; syncReferenceData() then loads the catalogue.
ALTER TABLE "subreddits" ADD COLUMN "display_name" text;--> statement-breakpoint
UPDATE "subreddits" SET "display_name" = "name";--> statement-breakpoint
ALTER TABLE "subreddits" ALTER COLUMN "display_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subreddits" ADD COLUMN "tier" text DEFAULT 'core' NOT NULL;--> statement-breakpoint
ALTER TABLE "subreddits" ALTER COLUMN "tier" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "subreddits" ADD COLUMN "status" text;--> statement-breakpoint
UPDATE "subreddits" SET "status" = CASE WHEN "active" THEN 'active' ELSE 'excluded' END;--> statement-breakpoint
ALTER TABLE "subreddits" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subreddits" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "subreddits" ADD COLUMN "posts_per_day" real;--> statement-breakpoint
ALTER TABLE "subreddits" ADD COLUMN "hiring_share" real;--> statement-breakpoint
ALTER TABLE "subreddits" ADD COLUMN "last_post_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subreddits" ADD COLUMN "stats_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subreddits" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "subreddits" ADD CONSTRAINT "subreddits_tier_check" CHECK ("subreddits"."tier" in ('core', 'low', 'regional', 'custom'));--> statement-breakpoint
ALTER TABLE "subreddits" ADD CONSTRAINT "subreddits_status_check" CHECK ("subreddits"."status" in ('active', 'excluded', 'dead', 'gone'));--> statement-breakpoint
ALTER TABLE "user_subreddits" ADD CONSTRAINT "user_subreddits_source_check" CHECK ("user_subreddits"."source" in ('user'));
