import { DRAFT_EXAMPLES, SKILLS, SUBREDDITS } from "@redlance/core";
import { and, asc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import type { Database } from "./client";
import { draftExamples, skills, subreddits } from "./schema";

/**
 * Copies the skill taxonomy, subreddit seed list and hand-written draft examples from
 * @redlance/core into Postgres.
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

    // Hand-written draft examples: upsert by id; ones dropped from code are deactivated, never
    // deleted (drafts may have been written with them). Winning examples are left alone.
    await tx
      .insert(draftExamples)
      .values(
        DRAFT_EXAMPLES.map((e) => ({
          id: e.id,
          jobType: e.jobType,
          channel: e.channel,
          style: e.style,
          postExcerpt: e.postExcerpt,
          text: e.text,
          source: "handwritten" as const,
          active: true,
        })),
      )
      .onConflictDoUpdate({
        target: draftExamples.id,
        set: {
          jobType: sql`excluded.job_type`,
          channel: sql`excluded.channel`,
          style: sql`excluded.style`,
          postExcerpt: sql`excluded.post_excerpt`,
          text: sql`excluded.text`,
          source: sql`excluded.source`,
          active: sql`excluded.active`,
        },
      });
    await tx
      .update(draftExamples)
      .set({ active: false })
      .where(
        and(
          eq(draftExamples.source, "handwritten"),
          notInArray(
            draftExamples.id,
            DRAFT_EXAMPLES.map((e) => e.id),
          ),
        ),
      );
  });
}

export type PickedExample = {
  id: string;
  jobType: string;
  channel: "comment" | "dm";
  style: string;
  postExcerpt: string;
  text: string;
};

/**
 * The few-shot examples for a draft prompt: 1 comment + up to n - 1 DMs for the job type, topped
 * up from `general` (then from the other channel) when there aren't enough. Ordered by id, so
 * the prompt's cached prefix is the same on every call for a job type.
 */
export async function pickExamples(
  db: Database,
  jobType: string,
  n = 3,
): Promise<PickedExample[]> {
  if (n <= 0) return [];
  const rows = await db
    .select({
      id: draftExamples.id,
      jobType: draftExamples.jobType,
      channel: draftExamples.channel,
      style: draftExamples.style,
      postExcerpt: draftExamples.postExcerpt,
      text: draftExamples.text,
    })
    .from(draftExamples)
    .where(
      and(
        eq(draftExamples.active, true),
        inArray(draftExamples.jobType, [jobType, "general"]),
      ),
    )
    .orderBy(asc(draftExamples.id));
  // The job type's own rows first, then general; each group in id order.
  const ranked = [
    ...rows.filter((r) => r.jobType === jobType),
    ...rows.filter((r) => r.jobType !== jobType),
  ];
  const comments = ranked.filter((r) => r.channel === "comment");
  const dms = ranked.filter((r) => r.channel === "dm");
  const picked = [...comments.slice(0, 1), ...dms.slice(0, n - 1)];
  // Short of one channel: fill from whatever is left, keeping the order.
  for (const r of ranked) {
    if (picked.length >= n) break;
    if (!picked.includes(r)) picked.push(r);
  }
  const order = (r: PickedExample) => (r.channel === "comment" ? 0 : 1);
  return picked.slice(0, n).sort((a, b) => order(a) - order(b));
}
