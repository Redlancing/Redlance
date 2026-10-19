CREATE TABLE "reply_sends" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reply_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"draft_id" uuid,
	"sent_text" text NOT NULL,
	"edit_ratio" real,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reply_sends_sent_text_check" CHECK (char_length("reply_sends"."sent_text") <= 10000)
);
--> statement-breakpoint
ALTER TABLE "drafts" DROP CONSTRAINT "drafts_user_match_version_unique";--> statement-breakpoint
ALTER TABLE "reply_sends" ADD CONSTRAINT "reply_sends_reply_id_replies_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."replies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_sends" ADD CONSTRAINT "reply_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_sends" ADD CONSTRAINT "reply_sends_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reply_sends_reply_sent_idx" ON "reply_sends" USING btree ("reply_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_user_match_version_idx" ON "drafts" USING btree ("user_id","match_id","version") WHERE "drafts"."status" <> 'failed';--> statement-breakpoint
INSERT INTO "reply_sends" ("id", "reply_id", "user_id", "draft_id", "sent_text", "edit_ratio", "sent_at")
SELECT gen_random_uuid(), "id", "user_id", "draft_id", "sent_text", "edit_ratio", "sent_at" FROM "replies";
