import {
  creditBalances,
  drafts,
  grantPlanCredits,
  profileProjects,
  profiles,
  refundCredits,
  users,
} from "@redlance/db";
import type { Plan } from "@redlance/core";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";

export async function userIdOf(email: string): Promise<string> {
  const [u] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  return u!.id;
}

/** A profile (the draft context joins it) and, by default, a full trial balance. */
export async function seedDraftUser(
  userId: string,
  opts: {
    plan?: Plan;
    trialEndsAt?: Date;
    balance?: number;
    grant?: boolean;
  } = {},
): Promise<void> {
  const db = getDb();
  const trialEndsAt = opts.trialEndsAt ?? new Date(Date.now() + 5 * 86_400_000);
  await db.insert(profiles).values({
    userId,
    displayName: "Asha",
    headline: "Web developer",
    categories: ["development"],
    experienceLevel: "intermediate",
    country: "IN",
    timeZone: "Asia/Kolkata",
    minRateMinor: 2500,
    currency: "USD",
    rateType: "hourly",
    remoteOnly: true,
    onboardedAt: new Date(),
    trialEndsAt,
    plan: opts.plan ?? "trial",
  });
  if (opts.grant === false) return;
  await grantPlanCredits(
    db,
    userId,
    opts.plan ?? "trial",
    new Date(Date.now() + 5 * 86_400_000),
    new Date(),
  );
  if (opts.balance !== undefined) {
    await db
      .update(creditBalances)
      .set({ balance: opts.balance })
      .where(eq(creditBalances.userId, userId));
  }
}

export async function balanceOf(userId: string): Promise<number> {
  const [r] = await getDb()
    .select({ b: creditBalances.balance })
    .from(creditBalances)
    .where(eq(creditBalances.userId, userId));
  return r!.b;
}

/** Stands in for the worker finishing a draft (Phase 7's completeDraft is not used here). */
export async function finishDraft(
  draftId: string,
  over: Partial<typeof drafts.$inferInsert> = {},
): Promise<void> {
  await getDb()
    .update(drafts)
    .set({
      status: "done",
      comment:
        "Your Next.js migration is exactly what I did for a SaaS last year.",
      dm: "Hi, saw your post about moving to Next.js. I recently shipped a similar migration and can start this week. What does your current stack look like?",
      problem: "Needs a Next.js migration",
      citedFact: "SaaS migration",
      evidence: {
        evidenceText: "SECRET-EVIDENCE-TEXT",
        summary: {
          projectTitle: "SaaS migration",
          roleTitle: null,
          skills: ["Next.js"],
        },
        redFlags: ["Vague budget"],
      },
      problems: [],
      finishedAt: new Date(),
      ...over,
    })
    .where(eq(drafts.id, draftId));
}

/** Stands in for the worker's final failure: failed + refund. */
export async function failDraftRow(
  draftId: string,
  userId: string,
  error = "INVALID_OUTPUT",
): Promise<void> {
  await getDb()
    .update(drafts)
    .set({ status: "failed", error, finishedAt: new Date() })
    .where(eq(drafts.id, draftId));
  await refundCredits(getDb(), { userId, draftId });
}

/** A visible project that matches the seeded posts (skill nextjs). */
export async function seedProject(
  userId: string,
  title: string,
  position = 0,
): Promise<string> {
  const [p] = await getDb()
    .insert(profileProjects)
    .values({
      userId,
      position,
      title,
      summary: "Built it",
      role: "solo",
      kind: "client",
      skillIds: ["nextjs"],
      categories: ["development"],
      source: "manual",
    })
    .returning({ id: profileProjects.id });
  return p!.id;
}
