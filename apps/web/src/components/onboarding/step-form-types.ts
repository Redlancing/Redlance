import type { PageId, StepDraft, StepId, StepStatus } from "@redlance/core";

/** What a step page hands its client form. */
export type StepFormInit<S extends StepId> = {
  userId: string;
  step: S;
  status: StepStatus | null;
  version: number;
  data: StepDraft<S>;
  resumeAt: PageId;
};
