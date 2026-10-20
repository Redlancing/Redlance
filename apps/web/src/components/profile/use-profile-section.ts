"use client";

import { STEP_SCHEMAS, toFieldErrors, type FieldError } from "@redlance/core";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  SECTION_STEP,
  sameSection,
  type ProfileSection,
  type SectionData,
} from "@/lib/profile-edit";
import { errorMessageFor } from "@/components/onboarding/form-errors";
import type { FieldsForm } from "@/components/onboarding/step-form-types";
import {
  saveFailure,
  type SaveFailure,
  type SaveResponse,
} from "./profile-state";

function focusFirstInvalid() {
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  );
}

/**
 * One profile section being edited. Mounted when the user clicks Edit, so every edit starts
 * from the saved data. Checks with the onboarding step's complete schema before sending; the
 * server checks again.
 */
export function useProfileSection<K extends ProfileSection>({
  section,
  saved,
  version,
  timeZone,
  onSaved,
  onFailed,
}: {
  section: K;
  saved: SectionData<K>;
  /** The profile version the page last saw: the save's expectedVersion. */
  version: number;
  timeZone: string;
  onSaved: (res: SaveResponse<K>) => void;
  onFailed?: (failure: SaveFailure) => void;
}) {
  const [value, setValue] = useState(saved);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const dirty = !sameSection(section, value, saved);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function fail(next: SaveFailure) {
    setFailure(next);
    if (next.kind === "invalid") {
      setErrors(next.errors);
      focusFirstInvalid();
    }
    onFailed?.(next);
  }

  async function save() {
    if (pending) return;
    const checked =
      STEP_SCHEMAS[SECTION_STEP[section]].complete.safeParse(value);
    setFailure(null);
    if (!checked.success) {
      fail({ kind: "invalid", errors: toFieldErrors(checked.error) });
      return;
    }
    setErrors([]);
    setPending(true);
    const res = await apiFetch<SaveResponse<K>>(`/api/v1/profile/${section}`, {
      method: "PUT",
      json: { data: checked.data, expectedVersion: version },
    });
    setPending(false);
    if (res.ok) onSaved(res.data);
    else fail(saveFailure(res, timeZone));
  }

  const form: FieldsForm<(typeof SECTION_STEP)[K]> = {
    value: value as FieldsForm<(typeof SECTION_STEP)[K]>["value"],
    update: (patch) => {
      setValue((v) => ({ ...v, ...patch }) as SectionData<K>);
      if (failure?.kind !== "invalid") setFailure(null);
    },
    errorFor: (path) => errorMessageFor(errors, path),
    pending,
  };

  return { form, dirty, pending, failure, save };
}
