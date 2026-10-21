import type { FieldError } from "@redlance/core";
import type { ApiFail } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-errors";
import {
  PROFILE_EDIT_LIMIT,
  allowanceText,
  type EditAllowance,
  type ProfileSection,
  type SectionData,
} from "@/lib/profile-edit";

/** What `PUT /api/v1/profile/:section` answers. */
export type SaveResponse<K extends ProfileSection = ProfileSection> = {
  changed: boolean;
  version: number;
  data: SectionData<K>;
  allowance: EditAllowance;
};

/** Server field errors are under `data.`; the fields know them without it. */
export function fieldErrorsFrom(details: unknown): FieldError[] {
  if (!Array.isArray(details)) return [];
  return details
    .filter(
      (e): e is FieldError =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as FieldError).path === "string" &&
        typeof (e as FieldError).message === "string",
    )
    .map((e) => ({ ...e, path: e.path.replace(/^data\.?/, "") }));
}

export type SaveFailure =
  | { kind: "invalid"; errors: FieldError[] }
  | { kind: "conflict" }
  | { kind: "limit"; nextFreeAt: string | null; message: string }
  | { kind: "error"; message: string };

/** Sorts a failed save into what the section shows. */
export function saveFailure(fail: ApiFail, timeZone?: string): SaveFailure {
  if (fail.code === "INVALID_INPUT") {
    const errors = fieldErrorsFrom(fail.details);
    if (errors.length) return { kind: "invalid", errors };
  }
  if (fail.code === "VERSION_CONFLICT") return { kind: "conflict" };
  if (fail.code === "PROFILE_EDIT_LIMIT") {
    const details = fail.details as { nextFreeAt?: unknown } | undefined;
    const nextFreeAt =
      typeof details?.nextFreeAt === "string" ? details.nextFreeAt : null;
    const next = nextFreeAt
      ? allowanceText(
          {
            limit: PROFILE_EDIT_LIMIT,
            used: PROFILE_EDIT_LIMIT,
            remaining: 0,
            nextFreeAt,
          },
          timeZone,
        ).next
      : null;
    return {
      kind: "limit",
      nextFreeAt,
      message: next
        ? `You've used all your profile changes for this week. ${next}.`
        : errorMessage(fail),
    };
  }
  return { kind: "error", message: errorMessage(fail) };
}

/** The toast after a save that went through. */
export const savedToast = (res: Pick<SaveResponse, "changed">) =>
  res.changed ? "Profile updated" : "Nothing changed, so it wasn't counted";

/**
 * After a limit refusal the page shows 0 left until the server says otherwise. Keeps a known
 * nextFreeAt when the error didn't carry one.
 */
export function exhausted(
  allowance: EditAllowance,
  nextFreeAt: string | null,
): EditAllowance {
  return {
    ...allowance,
    used: Math.max(allowance.used, allowance.limit),
    remaining: 0,
    nextFreeAt: nextFreeAt ?? allowance.nextFreeAt,
  };
}

/** Editing needs a change left; a section already open can still be saved (a no-op is free). */
export const canStartEdit = (allowance: EditAllowance) =>
  allowance.remaining > 0;
