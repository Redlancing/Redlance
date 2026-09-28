import { SKILLS, SUBREDDITS } from "@redlance/core";
import { notInArray, sql } from "drizzle-orm";
import type { Database } from "./client";
import { skills, subreddits } from "./schema";

/**
 * Copies the skill taxonomy and subreddit seed list from @redlance/core into Postgres.
 * Upserts only: rows missing from core are retired / deactivated, never deleted, because
 * saved profiles reference them.
 */
export async function syncReferenceData(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    // Two processes starting at once (web tests + db tests) must not interleave.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('redlance:reference-data'))`);

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
      .where(notInArray(skills.id, SKILLS.map((s) => s.id)));

    await tx
      .insert(subreddits)
      .values(SUBREDDITS.map((s) => ({ name: s.name, categories: [...s.categories], active: true })))
      .onConflictDoUpdate({
        target: subreddits.name,
        set: { categories: sql`excluded.categories`, active: sql`true` },
      });
    await tx
      .update(subreddits)
      .set({ active: false })
      .where(notInArray(subreddits.name, SUBREDDITS.map((s) => s.name)));
  });
}
