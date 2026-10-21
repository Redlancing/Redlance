import "server-only";
import {
  BACKFILL_DAYS,
  STEP_IDS,
  STEP_SCHEMAS,
  TRIAL_DAYS,
  nextPage,
  pageIndex,
  resumeAt,
  toFieldErrors,
  type PageId,
  type StepData,
  type StepId,
  type StepStatus,
} from "@redlance/core";
import {
  latestImportJobs,
  type Database,
  alertChannels,
  grantPlanCredits,
  onboardingSteps,
  profileExperience,
  profileProjects,
  profileSkills,
  profiles,
  requestRematch,
  users,
} from "@redlance/db";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { ApiError } from "../errors";
import { toImportSummary, type ImportSummary } from "./imports";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Executor = ReturnType<typeof getDb> | Tx;

export type StepRow = {
  step: StepId;
  status: StepStatus;
  data: unknown;
  version: number;
  updatedAt: Date;
};

export type OnboardingState = {
  steps: StepRow[];
  resumeAt: PageId;
  onboardedAt: Date | null;
  trialEndsAt: Date | null;
  imports: { resume: ImportSummary | null; github: ImportSummary | null };
};

export type SaveStepInput = {
  mode: "draft" | "complete";
  data: unknown;
  expectedVersion: number;
};

export type SaveStepResult = {
  status: StepStatus;
  version: number;
  next: PageId;
};

export async function getOnboardingState(
  userId: string,
  db: Executor = getDb(),
): Promise<OnboardingState> {
  const [rows, [profile], jobs] = await Promise.all([
    db
      .select({
        step: onboardingSteps.step,
        status: onboardingSteps.status,
        data: onboardingSteps.data,
        version: onboardingSteps.version,
        updatedAt: onboardingSteps.updatedAt,
      })
      .from(onboardingSteps)
      .where(eq(onboardingSteps.userId, userId)),
    db
      .select({
        onboardedAt: profiles.onboardedAt,
        trialEndsAt: profiles.trialEndsAt,
      })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1),
    // A transaction exposes the same query API as the database.
    latestImportJobs(db as Database, userId),
  ]);
  const steps = STEP_IDS.flatMap((id) => rows.filter((r) => r.step === id));
  return {
    steps,
    resumeAt: resumeAt(steps),
    onboardedAt: profile?.onboardedAt ?? null,
    trialEndsAt: profile?.trialEndsAt ?? null,
    imports: {
      resume: jobs.resume ? toImportSummary(jobs.resume) : null,
      github: jobs.github ? toImportSummary(jobs.github) : null,
    },
  };
}

/**
 * Saves one step. Rules: earlier steps must be completed (STEP_ORDER); a completed step
 * can't go back to draft; `expectedVersion` must match (0 = new row) or VERSION_CONFLICT.
 */
export async function saveStep(
  userId: string,
  step: StepId,
  input: SaveStepInput,
): Promise<SaveStepResult> {
  // FOR SHARE conflicts with Finish's FOR UPDATE, so a save either commits before Finish
  // reads the steps, or waits, sees the profile and is refused. Saves don't block each other.
  return getDb().transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("share");
    if (!locked) throw new ApiError("UNAUTHENTICATED", "Please sign in.");
    const state = await getOnboardingState(userId, tx);
    if (state.onboardedAt)
      throw new ApiError(
        "ALREADY_ONBOARDED",
        "Your profile is already set up.",
      );
    if (pageIndex(step) > pageIndex(state.resumeAt))
      throw new ApiError("STEP_ORDER", "Finish the earlier steps first.", {
        resumeAt: state.resumeAt,
      });
    const current = state.steps.find((s) => s.step === step);
    if (input.mode === "draft" && current?.status === "completed")
      throw new ApiError(
        "INVALID_INPUT",
        "This step is already complete. Use Save changes instead.",
      );

    const parsed = STEP_SCHEMAS[step][input.mode].safeParse(input.data);
    if (!parsed.success)
      throw new ApiError(
        "INVALID_INPUT",
        "Some fields are invalid.",
        toFieldErrors(parsed.error, "data"),
      );

    const status: StepStatus =
      input.mode === "complete" ? "completed" : "draft";
    const rows =
      input.expectedVersion === 0
        ? await tx
            .insert(onboardingSteps)
            .values({ userId, step, status, data: parsed.data })
            .onConflictDoNothing()
            .returning({ version: onboardingSteps.version })
        : await tx
            .update(onboardingSteps)
            .set({
              status,
              data: parsed.data,
              version: sql`${onboardingSteps.version} + 1`,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(onboardingSteps.userId, userId),
                eq(onboardingSteps.step, step),
                eq(onboardingSteps.version, input.expectedVersion),
              ),
            )
            .returning({ version: onboardingSteps.version });

    const saved = rows[0];
    if (!saved)
      throw new ApiError(
        "VERSION_CONFLICT",
        "This step was saved in another tab. Reload to see the latest version.",
      );
    return {
      status,
      version: saved.version,
      next: status === "completed" ? nextPage(step) : step,
    };
  });
}

async function completedSteps(tx: Tx, userId: string) {
  const rows = await tx
    .select({
      step: onboardingSteps.step,
      status: onboardingSteps.status,
      data: onboardingSteps.data,
    })
    .from(onboardingSteps)
    .where(eq(onboardingSteps.userId, userId));

  function read<S extends StepId>(step: S): StepData<S> {
    const row = rows.find((r) => r.step === step);
    const parsed =
      row?.status === "completed"
        ? STEP_SCHEMAS[step].complete.safeParse(row.data)
        : undefined;
    // A saved step that no longer passes (e.g. a tightened limit) sends the user back to it.
    if (!parsed?.success)
      throw new ApiError("STEP_ORDER", "Finish every step first.", {
        resumeAt: step,
      });
    return parsed.data as StepData<S>;
  }

  return {
    imported: read("import"),
    basics: read("basics"),
    skills: read("skills"),
    work: read("work"),
    rates: read("rates"),
  };
}

/**
 * Turns the saved steps into the profile, in one transaction. The user row lock makes a
 * double click wait for the first call, which then finds the profile and returns: the
 * trial starts exactly once.
 */
export async function finishOnboarding(
  userId: string,
): Promise<{ redirect: string }> {
  return getDb().transaction(async (tx) => {
    const [user] = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) throw new ApiError("UNAUTHENTICATED", "Please sign in.");

    const [existing] = await tx
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(eq(profiles.userId, userId));
    if (existing) return { redirect: "/dashboard" };

    const { basics, skills, work, rates, imported } = await completedSteps(
      tx,
      userId,
    );

    const [created] = await tx
      .insert(profiles)
      .values({
        userId,
        displayName: basics.displayName,
        headline: basics.headline,
        categories: basics.categories,
        experienceLevel: basics.experienceLevel,
        country: basics.country,
        timeZone: basics.timeZone,
        githubUsername: imported.githubUsername,
        minRateMinor: Math.round(rates.minRate * 100),
        currency: rates.currency,
        rateType: rates.rateType,
        remoteOnly: rates.remoteOnly,
        mentionEmployers: work.mentionEmployers,
        onboardedAt: sql`now()`,
        trialEndsAt: sql`now() + make_interval(days => ${TRIAL_DAYS})`,
      })
      .returning({ trialEndsAt: profiles.trialEndsAt });

    // The trial's credits, in the same transaction: no trial without credits, or the reverse.
    await grantPlanCredits(
      tx,
      userId,
      "trial",
      created!.trialEndsAt,
      new Date(),
    );

    if (skills.skills.length)
      await tx.insert(profileSkills).values(
        skills.skills.map((s) => ({
          userId,
          skillId: s.id,
          level: s.level,
          source: s.source,
        })),
      );

    // Position is the index in the step's list: the order the user sees and drafts use.
    // namesRemoved only drives the onboarding note, so it isn't stored.
    if (work.projects.length)
      await tx.insert(profileProjects).values(
        work.projects.map((p, position) => ({
          userId,
          position,
          title: p.title,
          summary: p.summary,
          role: p.role,
          kind: p.kind,
          skillIds: p.skills,
          categories: p.categories,
          domains: p.domains,
          outcomes: p.outcomes,
          links: p.links,
          year: p.year,
          source: p.source,
          hidden: p.hidden,
        })),
      );
    if (work.experience.length)
      await tx.insert(profileExperience).values(
        work.experience.map((r, position) => ({
          userId,
          position,
          title: r.title,
          summary: r.summary,
          organisation: r.organisation,
          organisationDescription: r.organisationDescription,
          employmentType: r.employmentType,
          startYear: r.start?.year ?? null,
          startMonth: r.start?.month ?? null,
          endYear: r.end?.year ?? null,
          endMonth: r.end?.month ?? null,
          isCurrent: r.current,
          highlights: r.highlights,
          skillIds: r.skills,
          categories: r.categories,
          domains: r.domains,
          source: r.source,
          hidden: r.hidden,
        })),
      );

    // Fill the new user's feed: the matcher backfills posts from the last few days.
    await requestRematch(
      tx,
      userId,
      new Date(Date.now() - BACKFILL_DAYS * 86_400_000),
    );

    // No subreddit rows: everyone's feed comes from the central catalogue, filtered by what
    // each post asks for (docs/ingestion/plan.md).

    // The sign-in email is verified by the auth provider (Cognito's one-time code later;
    // dev sessions exist only locally).
    await tx
      .insert(alertChannels)
      .values({
        userId,
        kind: "email",
        target: user.email,
        verifiedAt: sql`now()`,
      })
      .onConflictDoNothing();

    return { redirect: "/dashboard" };
  });
}
