CREATE TABLE "alert_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"error_code" text,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_deliveries_match_channel_unique" UNIQUE("match_id","channel"),
	CONSTRAINT "alert_deliveries_channel_check" CHECK ("alert_deliveries"."channel" in ('telegram')),
	CONSTRAINT "alert_deliveries_status_check" CHECK ("alert_deliveries"."status" in ('pending', 'sending', 'failed')),
	CONSTRAINT "alert_deliveries_attempts_check" CHECK ("alert_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "telegram_link_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_link_tokens_hash_check" CHECK ("telegram_link_tokens"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "alert_channels" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "alert_outcome" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "alert_routed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "alert_channels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "alert_score" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "alert_template" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "telegram_message_id" bigint;--> statement-breakpoint
-- Hand-added: matches that exist before alerts are never alerted.
UPDATE "matches" SET "alert_outcome" = 'skipped_backfill';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "alert_min_score" integer DEFAULT 70 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "alerts_daily_cap" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_deliveries_due_idx" ON "alert_deliveries" USING btree ("channel","run_after") WHERE "alert_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "alert_deliveries_sending_idx" ON "alert_deliveries" USING btree ("locked_at") WHERE "alert_deliveries"."status" = 'sending';--> statement-breakpoint
CREATE INDEX "alert_deliveries_user_idx" ON "alert_deliveries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "telegram_link_tokens_user_idx" ON "telegram_link_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "matches_alert_route_idx" ON "matches" USING btree ("created_at") WHERE "matches"."alert_outcome" is null;--> statement-breakpoint
CREATE INDEX "matches_user_routed_idx" ON "matches" USING btree ("user_id","alert_routed_at") WHERE "matches"."alert_outcome" in ('queued', 'sent', 'failed');--> statement-breakpoint
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_disabled_reason_check" CHECK ("alert_channels"."disabled_reason" is null or "alert_channels"."disabled_reason" in ('blocked', 'user_stop'));--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_alert_outcome_check" CHECK ("matches"."alert_outcome" is null or "matches"."alert_outcome" in ('queued', 'sent', 'failed', 'below_threshold', 'skipped_backfill', 'skipped_stale', 'skipped_trial', 'skipped_cap', 'skipped_no_channel', 'skipped_withdrawn'));--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_alert_score_check" CHECK ("matches"."alert_score" is null or "matches"."alert_score" between 0 and 100);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_alert_min_score_check" CHECK ("profiles"."alert_min_score" between 0 and 100);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_alerts_daily_cap_check" CHECK ("profiles"."alerts_daily_cap" between 1 and 100);