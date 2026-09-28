import "server-only";
import {
  STEP_IDS,
  STEP_SCHEMAS,
  nextPage,
  pageIndex,
  resumeAt,
  toFieldErrors,
  type PageId,
  type StepId,
  type StepStatus,
} from "@redlance/core";
import { onboardingSteps, profiles } from "@redlance/db";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { ApiError } from "../errors";

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
};

export type SaveStepInput = {
  mode: "draft" | "complete";
  data: unknown;
  expectedVersion: number;
};

export type SaveStepResult = { status: StepStatus; version: number; next: PageId };

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const db = getDb();
  const [rows, [profile]] = await Promise.all([
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
      .select({ onboardedAt: profiles.onboardedAt, trialEndsAt: profiles.trialEndsAt })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1),
  ]);
  const steps = STEP_IDS.flatMap((id) => rows.filter((r) => r.step === id));
  return {
    steps,
    resumeAt: resumeAt(steps),
    onboardedAt: profile?.onboardedAt ?? null,
    trialEndsAt: profile?.trialEndsAt ?? null,
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
  const state = await getOnboardingState(userId);
  if (state.onboardedAt)
    throw new ApiError("ALREADY_ONBOARDED", "Your profile is already set up.");
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

  const status: StepStatus = input.mode === "complete" ? "completed" : "draft";
  const db = getDb();
  const rows =
    input.expectedVersion === 0
      ? await db
          .insert(onboardingSteps)
          .values({ userId, step, status, data: parsed.data })
          .onConflictDoNothing()
          .returning({ version: onboardingSteps.version })
      : await db
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
  return { status, version: saved.version, next: status === "completed" ? nextPage(step) : step };
}
