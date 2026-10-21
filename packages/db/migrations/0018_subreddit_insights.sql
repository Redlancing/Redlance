CREATE TABLE "subreddit_insights" (
	"subreddit" text PRIMARY KEY NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hiring_posts" integer NOT NULL,
	"hiring_posts_prev" integer NOT NULL,
	"for_hire_posts" integer NOT NULL,
	"budget_stated" integer NOT NULL,
	"pay_counts" jsonb NOT NULL,
	"remote_counts" jsonb NOT NULL,
	"red_flag_posts" integer NOT NULL,
	"red_flag_counts" jsonb NOT NULL,
	"skill_counts" jsonb NOT NULL,
	"budgets" jsonb NOT NULL,
	"hour_slots" integer[] NOT NULL,
	"known_author_posts" integer NOT NULL,
	"repeat_author_posts" integer NOT NULL,
	"history_start" timestamp with time zone,
	CONSTRAINT "subreddit_insights_subreddit_check" CHECK ("subreddit_insights"."subreddit" ~ '^[a-z0-9_]{2,21}$'),
	CONSTRAINT "subreddit_insights_hour_slots_check" CHECK (cardinality("subreddit_insights"."hour_slots") = 336),
	CONSTRAINT "subreddit_insights_counts_check" CHECK ("subreddit_insights"."hiring_posts" >= 0 and "subreddit_insights"."hiring_posts_prev" >= 0 and "subreddit_insights"."for_hire_posts" >= 0
        and "subreddit_insights"."budget_stated" between 0 and "subreddit_insights"."hiring_posts"
        and "subreddit_insights"."red_flag_posts" between 0 and "subreddit_insights"."hiring_posts"
        and "subreddit_insights"."repeat_author_posts" between 0 and "subreddit_insights"."known_author_posts"
        and "subreddit_insights"."known_author_posts" <= "subreddit_insights"."hiring_posts")
);
