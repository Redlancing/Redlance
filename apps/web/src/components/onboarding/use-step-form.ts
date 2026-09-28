"use client";

import {
  STEP_SCHEMAS,
  toFieldErrors,
  type FieldError,
  type PageId,
  type StepDraft,
  type StepId,
  type StepStatus,
} from "@redlance/core";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  localCopyKey,
  parseLocalCopy,
  readLocal,
  removeLocal,
  sameJson,
  writeLocal,
} from "./local-copy";
import type { StepFormInit } from "./step-form-types";

export type { StepFormInit } from "./step-form-types";

type Notice = { kind: "saved" } | { kind: "conflict" } | { kind: "error"; message: string };
type SaveResult = { status: StepStatus; version: number; next: PageId };
type ErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

// The local copy as it was when the form mounted; this tab's own later writes don't count.
// Module-level so the render stays pure (useSyncExternalStore calls this during render).
const firstRead = new Map<string, string | null>();
const noopSubscribe = () => () => {};
const mountSnapshot = (key: string) => () => {
  if (!firstRead.has(key)) firstRead.set(key, readLocal(key));
  return firstRead.get(key) ?? null;
};
const serverSnapshot = () => null;

function focusFirstInvalid() {
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  );
}

export function useStepForm<S extends StepId>(
  init: StepFormInit<S>,
  options: { prepare?: (value: StepDraft<S>) => StepDraft<S> } = {},
) {
  const router = useRouter();
  const key = localCopyKey(init.userId, init.step);
  const [value, setValue] = useState(init.data);
  const [saved, setSaved] = useState({ data: init.data, version: init.version, status: init.status });
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [pending, setPending] = useState<"draft" | "complete" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [restoreHandled, setRestoreHandled] = useState(false);

  const dirty = !sameJson(value, saved.data);
  const localRaw = useSyncExternalStore(noopSubscribe, mountSnapshot(key), serverSnapshot);
  const restorable = restoreHandled ? null : parseLocalCopy(localRaw, init);

  useEffect(() => () => void firstRead.delete(key), [key]);

  // Safety net: unsaved values go to localStorage (never the server), 400 ms after typing stops.
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => writeLocal(key, saved.version, value), 400);
    return () => clearTimeout(timer);
  }, [key, dirty, value, saved.version]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function handleError(body: ErrorBody) {
    const code = body.error?.code;
    if (code === "VERSION_CONFLICT") setNotice({ kind: "conflict" });
    else if (code === "STEP_ORDER" || code === "ALREADY_ONBOARDED") router.refresh();
    else if (code === "INVALID_INPUT" && Array.isArray(body.error?.details)) {
      setErrors(
        (body.error.details as FieldError[]).map((e) => ({ ...e, path: e.path.replace(/^data\.?/, "") })),
      );
      focusFirstInvalid();
    } else
      setNotice({ kind: "error", message: body.error?.message ?? "Couldn't save. Please try again." });
  }

  async function save(mode: "draft" | "complete"): Promise<SaveResult | null> {
    if (pending) return null;
    const prepared = options.prepare ? options.prepare(value) : value;
    const checked = STEP_SCHEMAS[init.step][mode].safeParse(prepared);
    setNotice(null);
    if (!checked.success) {
      setErrors(toFieldErrors(checked.error));
      focusFirstInvalid();
      return null;
    }
    setErrors([]);
    setPending(mode);
    try {
      const res = await fetch(`/api/v1/onboarding/steps/${init.step}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, data: checked.data, expectedVersion: saved.version }),
      });
      const body = (await res.json().catch(() => ({}))) as SaveResult & ErrorBody;
      if (!res.ok) {
        handleError(body);
        return null;
      }
      const data = checked.data as StepDraft<S>;
      removeLocal(key);
      setSaved({ data, version: body.version, status: body.status });
      setValue(data);
      setRestoreHandled(true); // the earlier local copy is now stale
      return body;
    } catch {
      setNotice({ kind: "error", message: "Can't reach Redlance. Check your connection and try again." });
      return null;
    } finally {
      setPending(null);
    }
  }

  const completed = saved.status === "completed";

  return {
    step: init.step,
    resumeAt: init.resumeAt,
    value,
    setValue,
    update: (patch: Partial<StepDraft<S>>) => setValue((v) => ({ ...v, ...patch }) as StepDraft<S>),
    errorFor: (path: string) => errors.find((e) => e.path === path)?.message,
    pending,
    notice,
    dirty,
    completed,
    restorable,
    restore() {
      if (restorable) setValue(restorable);
      setRestoreHandled(true);
    },
    dismissRestore() {
      removeLocal(key);
      setRestoreHandled(true);
    },
    discard() {
      removeLocal(key);
      setValue(saved.data);
    },
    async next() {
      const result = await save("complete");
      if (result) router.push(`/onboarding/${result.next}`);
    },
    /** "Save draft", or "Save changes" on a completed step (full validation, stays completed). */
    async saveDraft(): Promise<boolean> {
      const result = await save(completed ? "complete" : "draft");
      if (result) setNotice({ kind: "saved" });
      return result !== null;
    },
  };
}

/**
 * What the shared pieces (StepActions, RestoreBanner) need from any step's form. The value
 * accessors are left out on purpose: they are typed per step and would not be assignable here.
 */
export type StepForm = Omit<ReturnType<typeof useStepForm>, "value" | "setValue" | "update">;
