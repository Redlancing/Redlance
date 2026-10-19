import type { PageId, StepId, StepStatus } from "@redlance/core";

/** The parts of `GET /api/v1/onboarding` a step form checks. */
export type ServerOnboarding = {
  steps: { id: StepId; status: StepStatus; version: number }[];
  resumeAt: PageId;
};

export const serverStepVersion = (server: ServerOnboarding, step: StepId) =>
  server.steps.find((s) => s.id === step)?.version ?? 0;

/**
 * Whether the form was built from an old page payload (the browser's back/forward reuses them):
 * the server has moved this step's version or status, or where onboarding resumes.
 */
export function isStale(
  local: {
    step: StepId;
    version: number;
    status: StepStatus | null;
    resumeAt: PageId;
  },
  server: ServerOnboarding,
): boolean {
  const row = server.steps.find((s) => s.id === local.step);
  return (
    (row?.version ?? 0) !== local.version ||
    (row?.status ?? null) !== local.status ||
    server.resumeAt !== local.resumeAt
  );
}

/** Reads the current onboarding state, or null when it can't (offline, signed out, …). */
export async function fetchOnboarding(): Promise<ServerOnboarding | null> {
  try {
    const res = await fetch("/api/v1/onboarding", { cache: "no-store" });
    return res.ok ? ((await res.json()) as ServerOnboarding) : null;
  } catch {
    return null;
  }
}
