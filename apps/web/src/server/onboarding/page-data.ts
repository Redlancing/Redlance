import "server-only";
import {
  STEP_IDS,
  STEP_SCHEMAS,
  defaultCurrency,
  emptyDraft,
  type StepData,
  type StepDraft,
  type StepId,
} from "@redlance/core";
import { redirect } from "next/navigation";
import type { StepFormInit } from "@/components/onboarding/step-form-types";
import { getCurrentUser } from "../current-user";
import { getOnboardingState, type OnboardingState } from "./service";

/** Guards every onboarding page (layouts don't re-render on client navigation, so pages do it). */
export async function loadOnboardingPage(path: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  const state = await getOnboardingState(user.userId);
  if (state.onboardedAt) redirect("/dashboard");
  return { user, state };
}

export function savedDraft<S extends StepId>(state: OnboardingState, step: S): StepDraft<S> | null {
  const row = state.steps.find((r) => r.step === step);
  const parsed = row ? STEP_SCHEMAS[step].draft.safeParse(row.data) : undefined;
  return parsed?.success ? (parsed.data as StepDraft<S>) : null;
}

function defaultsFor<S extends StepId>(step: S, state: OnboardingState): StepDraft<S> {
  const empty = emptyDraft(step);
  if (step === "rates")
    return {
      ...(empty as StepDraft<"rates">),
      currency: defaultCurrency(savedDraft(state, "basics")?.country ?? null),
    } as StepDraft<S>;
  return empty;
}

export function stepInit<S extends StepId>(
  state: OnboardingState,
  userId: string,
  step: S,
): StepFormInit<S> {
  const row = state.steps.find((r) => r.step === step);
  return {
    userId,
    step,
    status: row?.status ?? null,
    version: row?.version ?? 0,
    data: row ? (savedDraft(state, step) ?? emptyDraft(step)) : defaultsFor(step, state),
    resumeAt: state.resumeAt,
  };
}

export type ReviewData = { [S in StepId]: StepData<S> };

export function reviewData(
  state: OnboardingState,
): { ok: true; data: ReviewData } | { ok: false; step: StepId } {
  const out: Partial<Record<StepId, unknown>> = {};
  for (const step of STEP_IDS) {
    const row = state.steps.find((r) => r.step === step);
    const parsed = row?.status === "completed" ? STEP_SCHEMAS[step].complete.safeParse(row.data) : undefined;
    if (!parsed?.success) return { ok: false, step };
    out[step] = parsed.data;
  }
  return { ok: true, data: out as ReviewData };
}
