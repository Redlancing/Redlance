CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
ALTER TABLE "job_posts" ADD COLUMN "duplicate_of" uuid;--> statement-breakpoint
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_duplicate_of_job_posts_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."job_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_posts_author_posted_idx" ON "job_posts" USING btree ("author","posted_at");--> statement-breakpoint
CREATE INDEX "job_posts_duplicate_of_idx" ON "job_posts" USING btree ("duplicate_of") WHERE "job_posts"."duplicate_of" is not null;