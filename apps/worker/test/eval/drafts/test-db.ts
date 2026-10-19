import {
  drafts,
  jobPostAnalyses,
  jobPosts,
  matches,
  outcomes,
  profileExperience,
  profiles,
  replies,
  users,
  type Database,
} from "@redlance/db";

// Seed helpers for the candidates and winners tests (a user with a profile and an employer,
// a post with its analysis, a match and a finished draft).

let seq = 0;

export async function seedUser(
  db: Database,
  over: {
    displayName?: string;
    githubUsername?: string | null;
    org?: string;
  } = {},
) {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|ev${seq}-${Math.random()}`,
      email: `ev${seq}@example.com`,
      emailNormalized: `ev${seq}-${Math.random()}@example.com`,
    })
    .returning({ id: users.id });
  const userId = u!.id;
  await db.insert(profiles).values({
    userId,
    displayName: over.displayName ?? "Maya Okafor",
    categories: ["development"],
    experienceLevel: "intermediate",
    country: "GB",
    timeZone: "Europe/London",
    githubUsername:
      over.githubUsername === undefined
        ? "maya-okafor-dev"
        : over.githubUsername,
    minRateMinor: 4000,
    currency: "USD",
    rateType: "hourly",
    remoteOnly: true,
    onboardedAt: new Date(),
    trialEndsAt: new Date(Date.now() + 5 * 86_400_000),
  });
  await db.insert(profileExperience).values({
    userId,
    position: 0,
    title: "Developer",
    summary: "Built web apps.",
    skillIds: [],
    categories: [],
    domains: [],
    source: "manual",
    organisation: over.org ?? "Brightwave Studios",
    organisationDescription: "a design studio",
    employmentType: "full_time",
    isCurrent: false,
  });
  return userId;
}

export async function seedPostAndDraft(
  db: Database,
  userId: string,
  over: {
    title?: string;
    body?: string;
    styleTags?: string[];
    version?: number;
  } = {},
) {
  seq++;
  const [p] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_ev${seq}-${Math.random()}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/ev${seq}/x/`,
      title: over.title ?? "[Hiring] React dashboard for a small team",
      body: over.body ?? "We need a React dashboard with charts. DM me.",
      author: "someclient",
      postedAt: new Date(),
      preKind: "hiring",
    })
    .returning({ id: jobPosts.id });
  await db.insert(jobPostAnalyses).values({
    jobPostId: p!.id,
    pipelineVersion: "test",
    kind: "hiring",
    employmentType: "freelance",
    payType: "paid",
    categories: ["development"],
    skillIds: ["react"],
    budgetMin: null,
    budgetMax: null,
    remote: "remote",
    redFlags: [],
    summary: "Build a React dashboard.",
    model: "test",
    applyInstructions: "DM only",
  });
  const [m] = await db
    .insert(matches)
    .values({
      userId,
      jobPostId: p!.id,
      postedAt: new Date(),
      ruleScore: 60,
      broad: false,
      features: [],
      ruleReason: "r",
      aiStatus: "not_needed",
      score: 60,
      profileVersion: 1,
      analysedAt: new Date(),
    })
    .returning({ id: matches.id });
  const [d] = await db
    .insert(drafts)
    .values({
      userId,
      matchId: m!.id,
      jobPostId: p!.id,
      version: over.version ?? 1,
      kind: "draft",
      status: "done",
      comment: "Sent you a DM.",
      dm: "Hi there.",
      styleTags: over.styleTags ?? ["problem_first", "has_link"],
      problems: [{ code: "UNKNOWN_LINK" }],
    })
    .returning({ id: drafts.id });
  return { jobPostId: p!.id, matchId: m!.id, draftId: d!.id };
}

export async function seedReply(
  db: Database,
  s: { userId: string; jobPostId: string; matchId: string; draftId: string },
  over: {
    status?: "sent" | "replied" | "hired" | "lost" | "no_reply" | "ghosted";
    editRatio?: number | null;
    sentText?: string;
    kind?: "comment" | "dm";
    outcome?: "replied" | "hired" | "no_reply" | "lost";
  } = {},
) {
  const [r] = await db
    .insert(replies)
    .values({
      userId: s.userId,
      matchId: s.matchId,
      jobPostId: s.jobPostId,
      draftId: s.draftId,
      kind: over.kind ?? "dm",
      sentText: over.sentText ?? LONG_DM,
      editRatio: over.editRatio === undefined ? 0.1 : over.editRatio,
      sentAt: new Date(),
      status: over.status ?? "sent",
    })
    .returning({ id: replies.id });
  if (over.outcome)
    await db
      .insert(outcomes)
      .values({ replyId: r!.id, userId: s.userId, type: over.outcome });
  return r!.id;
}

/** 40+ plain words, no numbers or links. */
export const LONG_DM =
  "Hi, your dashboard sounds like something I could take on without a long ramp up. I recently built a reporting tool with charts and filters for a small team, and the people using it said it was easy to follow. I would start with the main views you need, get those working first, and then add the rest. Would a short call this week suit you?";
