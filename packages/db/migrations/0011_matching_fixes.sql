DROP INDEX "matches_feed_idx";--> statement-breakpoint
-- analysed_at is added nullable, backfilled from the analysis each row was scored from (to the
-- millisecond, as the app reads it), then made NOT NULL. A row without an analysis (none
-- should exist) falls back to its own created_at.
ALTER TABLE "matches" ADD COLUMN "analysed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "matches" m SET "analysed_at" = coalesce(
  (SELECT date_trunc('milliseconds', a."created_at") FROM "job_post_analyses" a WHERE a."job_post_id" = m."job_post_id"),
  date_trunc('milliseconds', m."created_at"));--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "analysed_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "ai_unit_day" date;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "ai_finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "rematch_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "rematch_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "rematch_after" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "matches_feed_idx" ON "matches" USING btree ("user_id","posted_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "matches"."status" <> 'dismissed' and "matches"."withdrawn_at" is null;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_rematch_attempts_check" CHECK ("profiles"."rematch_attempts" >= 0);--> statement-breakpoint
-- Queue the last 7 days of matchable posts that were analysed before matching existed
-- (match_status null), so the matcher picks them up.
UPDATE "job_posts" j SET "match_status" = 'pending'
FROM "job_post_analyses" a
WHERE a."job_post_id" = j."id"
  AND j."match_status" IS NULL
  AND j."analysis_status" = 'done'
  AND j."duplicate_of" IS NULL
  AND j."posted_at" >= now() - interval '7 days'
  AND a."kind" = 'hiring'
  AND a."employment_type" <> 'full_time';
