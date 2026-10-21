CREATE TABLE "profile_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"section" text NOT NULL,
	"profile_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_changes_section_check" CHECK ("profile_changes"."section" in ('basics', 'skills', 'work', 'rates', 'github')),
	CONSTRAINT "profile_changes_profile_version_check" CHECK ("profile_changes"."profile_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "profile_changes" ADD CONSTRAINT "profile_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_changes_user_created_idx" ON "profile_changes" USING btree ("user_id","created_at");