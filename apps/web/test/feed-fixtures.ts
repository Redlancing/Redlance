import {
  jobPostAnalyses,
  jobPosts,
  matches,
  profileProjects,
  upsertMatches,
  type NewMatch,
} from "@redlance/db";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db";

let seq = 0;

export async function clearPosts(): Promise<void> {
  await getDb().execute(sql`truncate table job_posts cascade`);
}

export type SeedPost = {
  community?: string;
  postedAt?: Date;
  categories?: string[];
  payType?: "paid" | "unpaid" | "unknown";
  duplicateOf?: string | null;
  budget?: { min: number; max: number; currency: string; unit: "fixed" };
  summary?: string;
  applyInstructions?: string | null;
  redFlags?: string[];
};

export async function seedPost(spec: SeedPost = {}): Promise<string> {
  seq++;
  const db = getDb();
  const [row] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_feed${seq}_${Date.now()}`,
      fetchedVia: "rss",
      community: spec.community ?? "forhire",
      url: `https://www.reddit.com/r/forhire/comments/feed${seq}/x/`,
      title: `[Hiring] Gig ${seq}`,
      body: "Need help.",
      author: `author${seq}`,
      postedAt: spec.postedAt ?? new Date(Date.now() - 3_600_000),
      preKind: "hiring",
      analysisStatus: "done",
      matchStatus: "done",
      duplicateOf: spec.duplicateOf ?? null,
    })
    .returning({ id: jobPosts.id });
  await db.insert(jobPostAnalyses).values({
    jobPostId: row!.id,
    pipelineVersion: "post@1",
    kind: "hiring",
    employmentType: "freelance",
    payType: spec.payType ?? "paid",
    categories: spec.categories ?? ["development"],
    skillIds: ["nextjs"],
    budgetMin: spec.budget?.min ?? null,
    budgetMax: spec.budget?.max ?? null,
    currency: spec.budget?.currency ?? null,
    budgetUnit: spec.budget?.unit ?? null,
    remote: "remote",
    location: null,
    deadline: null,
    redFlags: spec.redFlags ?? [],
    summary: spec.summary ?? `Gig ${seq}`,
    applyInstructions: spec.applyInstructions ?? null,
    model: "gemini-test",
  });
  return row!.id;
}

/** Inserts a match through upsertMatches and returns its id. */
export async function seedMatch(
  userId: string,
  jobPostId: string,
  over: Partial<NewMatch> = {},
): Promise<string> {
  const db = getDb();
  await upsertMatches(db, [
    {
      userId,
      jobPostId,
      ruleScore: 80,
      broad: false,
      features: [{ signal: "core_skill", points: 40, detail: ["nextjs"] }],
      ruleReason: "Rule reason",
      aiStatus: "not_needed",
      profileVersion: 1,
      ...over,
    },
  ]);
  const [m] = await db
    .select({ id: matches.id })
    .from(matches)
    .where(
      sql`${matches.userId} = ${userId} and ${matches.jobPostId} = ${jobPostId}`,
    );
  return m!.id;
}

/** Marks a match as AI-scored (what the re-scorer would write). */
export async function finishAi(
  matchId: string,
  userId: string,
  fields: { aiScore: number; aiReason: string; projectTitle?: string },
): Promise<string | null> {
  const db = getDb();
  let projectId: string | null = null;
  if (fields.projectTitle) {
    const [p] = await db
      .insert(profileProjects)
      .values({
        userId,
        position: 0,
        title: fields.projectTitle,
        summary: "Built it",
        role: "solo",
        kind: "client",
        skillIds: ["nextjs"],
        source: "manual",
        hidden: false,
      })
      .returning({ id: profileProjects.id });
    projectId = p!.id;
  }
  await db
    .update(matches)
    .set({
      aiStatus: "done",
      aiScore: fields.aiScore,
      aiReason: fields.aiReason,
      aiConcerns: [],
      aiModel: "gemini-test",
      aiScoredAt: new Date(),
      score: fields.aiScore,
      bestProjectId: projectId,
      aiError: "SECRET_INTERNAL",
    })
    .where(eq(matches.id, matchId));
  return projectId;
}
