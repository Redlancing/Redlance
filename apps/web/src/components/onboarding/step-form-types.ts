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

/**
 * What a step's fields need from a form: the onboarding step form (`useStepForm`) or a profile
 * section (`useProfileSection`). The fields render the same either way.
 */
export type FieldsForm<S extends StepId> = {
  value: StepDraft<S>;
  update: (patch: Partial<StepDraft<S>>) => void;
  errorFor: (path: string) => string | undefined;
  /** Truthy while a save is running: the fields are disabled. */
  pending: unknown;
};
