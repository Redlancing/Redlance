// Seeding for the Telegram sender and bot tests (real Postgres).
import {
  alertChannels,
  jobPostAnalyses,
  jobPosts,
  matches,
  profiles,
  users,
  withRoutingBatch,
  type Database,
} from "@redlance/db";

let seq = 0;

export async function seedUser(
  db: Database,
  opts: { chatId?: string; telegram?: "linked" | "none" } = {},
): Promise<string> {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|tg${seq}-${Math.random()}`,
      email: "a@example.com",
      emailNormalized: `tg${seq}-${Math.random()}@example.com`,
    })
    .returning();
  await db.insert(profiles).values({
    userId: u!.id,
    displayName: "A",
    categories: ["development"],
    experienceLevel: "intermediate",
    country: "US",
    timeZone: "UTC",
    minRateMinor: 0,
    currency: "USD",
    rateType: "either",
    remoteOnly: true,
    onboardedAt: new Date(),
    trialEndsAt: new Date(Date.now() + 5 * 86_400_000),
  });
  if ((opts.telegram ?? "linked") === "linked") {
    await db.insert(alertChannels).values({
      userId: u!.id,
      kind: "telegram",
      target: opts.chatId ?? String(5000 + seq),
      enabled: true,
      verifiedAt: new Date(),
    });
  }
  return u!.id;
}

/** `n` matches for the user, routed straight to the Telegram queue. Returns the match ids. */
export async function queueAlerts(
  db: Database,
  userId: string,
  n: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    seq++;
    const [p] = await db
      .insert(jobPosts)
      .values({
        source: "reddit",
        externalId: `t3_tg${seq}-${Math.random()}`,
        fetchedVia: "rss",
        community: "forhire",
        url: `https://www.reddit.com/r/forhire/comments/tg${seq}/x/`,
        title: `[Hiring] Gig <${seq}>`,
        body: "Need help.",
        postedAt: new Date(Date.now() - 5 * 60_000),
        preKind: "hiring",
      })
      .returning();
    await db.insert(jobPostAnalyses).values({
      jobPostId: p!.id,
      pipelineVersion: "t",
      kind: "hiring",
      employmentType: "freelance",
      payType: "paid",
      categories: ["development"],
      skillIds: [],
      budgetMin: 400,
      budgetMax: 600,
      currency: "USD",
      budgetUnit: "fixed",
      remote: "remote",
      redFlags: [],
      summary: "s",
      model: "m",
    });
    const [m] = await db
      .insert(matches)
      .values({
        userId,
        jobPostId: p!.id,
        postedAt: p!.postedAt,
        ruleScore: 80,
        broad: false,
        features: [],
        ruleReason: "Strong fit: Next.js & Stripe",
        aiStatus: "not_needed",
        score: 80,
        profileVersion: 1,
        analysedAt: new Date(),
      })
      .returning();
    ids.push(m!.id);
  }
  await withRoutingBatch(db, { limit: 1000 }, (items) =>
    items.map((i) => ({
      matchId: i.matchId,
      outcome: "queued" as const,
      channels: ["telegram" as const],
    })),
  );
  return ids;
}
