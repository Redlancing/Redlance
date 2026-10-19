import { SKILLS, SUBREDDITS } from "@redlance/core";
import { and, ne, notInArray, sql } from "drizzle-orm";
import type { Database } from "./client";
import { skills, subreddits } from "./schema";

/**
 * Copies the skill taxonomy and subreddit seed list from @redlance/core into Postgres.
 * Upserts only: rows missing from core are retired (skills) or excluded (subreddits), never
 * deleted, because saved profiles and posts reference them.
 */
export async function syncReferenceData(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    // Two processes starting at once (web tests + db tests) must not interleave.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('redlance:reference-data'))`,
    );

    await tx
      .insert(skills)
      .values(
        SKILLS.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          aliases: [...s.aliases],
          retired: s.retired ?? false,
        })),
      )
      .onConflictDoUpdate({
        target: skills.id,
        set: {
          name: sql`excluded.name`,
          category: sql`excluded.category`,
          aliases: sql`excluded.aliases`,
          retired: sql`excluded.retired`,
        },
      });
    await tx
      .update(skills)
      .set({ retired: true })
      .where(
        notInArray(
          skills.id,
          SKILLS.map((s) => s.id),
        ),
      );

    await tx
      .insert(subreddits)
      .values(
        SUBREDDITS.map((s) => ({
          name: s.name,
          displayName: s.displayName,
          categories: [...s.categories],
          tier: s.tier,
          status: s.status,
          note: s.note ?? null,
          postsPerDay: s.postsPerDay ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: subreddits.name,
        // The study's volume only seeds an empty stat; the worker owns the stats columns after that.
        set: {
          postsPerDay: sql`coalesce(${subreddits.postsPerDay}, excluded.posts_per_day)`,
          displayName: sql`excluded.display_name`,
          categories: sql`excluded.categories`,
          tier: sql`excluded.tier`,
          status: sql`excluded.status`,
          note: sql`excluded.note`,
        },
      });
    // Dropped from the catalogue: stop polling, keep the row (posts reference its name).
    await tx
      .update(subreddits)
      .set({ status: "excluded", note: "removed from the catalogue" })
      .where(
        and(
          ne(subreddits.tier, "custom"),
          notInArray(
            subreddits.name,
            SUBREDDITS.map((s) => s.name),
          ),
        ),
      );
  });
}
