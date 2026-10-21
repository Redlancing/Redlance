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
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { errorMessageFor } from "./form-errors";
import {
  localCopyKey,
  parseLocalCopy,
  readLocal,
  removeLocal,
  sameJson,
  writeLocal,
} from "./local-copy";
import { fetchOnboarding, isStale, serverStepVersion } from "./stale-step";
import type { StepFormInit } from "./step-form-types";

export type { StepFormInit } from "./step-form-types";

type Notice =
  | { kind: "saved"; changes: boolean }
  | { kind: "conflict" }
  | { kind: "invalid" }
  | { kind: "error"; message: string };
type SaveResult = { status: StepStatus; version: number; next: PageId };
type ErrorBody = {
  error?: { code?: string; message?: string; details?: unknown };
};

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
  const [saved, setSaved] = useState({
    data: init.data,
    version: init.version,
    status: init.status,
  });
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [pending, setPending] = useState<"draft" | "complete" | null>(null);
  // A ref, not state: a second click can arrive before React re-renders with `pending` set.
  const busyRef = useRef(false);
  // After Next succeeds the buttons stay disabled until the next page replaces this one.
  const [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [restoreHandled, setRestoreHandled] = useState(false);
  // After a version conflict, the local copy is written against the server's newer version so a
  // reload offers these edits back.
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const savedRef = useRef(saved);

  const dirty = !sameJson(value, saved.data);
  const localRaw = useSyncExternalStore(
    noopSubscribe,
    mountSnapshot(key),
    serverSnapshot,
  );
  const restorable = restoreHandled ? null : parseLocalCopy(localRaw, init);

  useEffect(() => () => void firstRead.delete(key), [key]);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  // Browser back/forward reuses old page payloads (and the bfcache restores whole pages), so the
  // form may start from an out-of-date step. Check the server once on mount and on a bfcache
  // restore; if it moved on, refresh. page.tsx keys the form by version, so it remounts fresh.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      const server = await fetchOnboarding();
      if (cancelled || !server) return;
      const { version, status } = savedRef.current;
      const local = {
        step: init.step,
        version,
        status,
        resumeAt: init.resumeAt,
      };
      if (isStale(local, server)) router.refresh();
    }
    void check();
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      // Restored from the bfcache after Next: the buttons must work again.
      busyRef.current = false;
      setLeaving(false);
      void check();
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", onShow);
    };
  }, [init.step, init.resumeAt, router]);

  // Safety net: unsaved values go to localStorage (never the server), 400 ms after typing stops.
  const localVersion = conflictVersion ?? saved.version;
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => writeLocal(key, localVersion, value), 400);
    return () => clearTimeout(timer);
  }, [key, dirty, value, localVersion]);

  useEffect(() => {
    // After a conflict the edits are already kept in this browser, so Reload needn't warn.
    if (!dirty || conflictVersion !== null) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, conflictVersion]);

  function showErrors(list: FieldError[]) {
    setErrors(list);
    // Also a notice by the buttons, so a failed Next always shows something.
    setNotice({ kind: "invalid" });
    focusFirstInvalid();
  }

  /** Keeps this tab's edits for the reload: stored against the version the server has now. */
  async function keepEditsForReload() {
    const server = await fetchOnboarding();
    if (server) {
      const version = serverStepVersion(server, init.step);
      writeLocal(key, version, value);
      setConflictVersion(version);
    }
    setNotice({ kind: "conflict" });
  }

  async function handleError(body: ErrorBody) {
    const code = body.error?.code;
    if (code === "VERSION_CONFLICT") await keepEditsForReload();
    else if (code === "STEP_ORDER" || code === "ALREADY_ONBOARDED")
      router.refresh();
    else if (code === "INVALID_INPUT" && Array.isArray(body.error?.details)) {
      showErrors(
        (body.error.details as FieldError[]).map((e) => ({
          ...e,
          path: e.path.replace(/^data\.?/, ""),
        })),
      );
    } else
      setNotice({
        kind: "error",
        message: body.error?.message ?? "Couldn't save. Please try again.",
      });
  }

  async function save(mode: "draft" | "complete"): Promise<SaveResult | null> {
    if (busyRef.current) return null;
    const prepared = options.prepare ? options.prepare(value) : value;
    const checked = STEP_SCHEMAS[init.step][mode].safeParse(prepared);
    setNotice(null);
    if (!checked.success) {
      showErrors(toFieldErrors(checked.error));
      return null;
    }
    setErrors([]);
    busyRef.current = true;
    setPending(mode);
    try {
      const res = await fetch(`/api/v1/onboarding/steps/${init.step}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          data: checked.data,
          expectedVersion: saved.version,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as SaveResult &
        ErrorBody;
      if (!res.ok) {
        await handleError(body);
        return null;
      }
      const data = checked.data as StepDraft<S>;
      removeLocal(key);
      setSaved({ data, version: body.version, status: body.status });
      setValue(data);
      setRestoreHandled(true); // the earlier local copy is now stale
      setConflictVersion(null);
      return body;
    } catch {
      setNotice({
        kind: "error",
        message: "Can't reach Redlance. Check your connection and try again.",
      });
      return null;
    } finally {
      busyRef.current = false;
      setPending(null);
    }
  }

  const completed = saved.status === "completed";

  function edit(next: StepDraft<S> | ((v: StepDraft<S>) => StepDraft<S>)) {
    setValue(next);
    setNotice((n) => (n?.kind === "saved" ? null : n)); // "Draft saved." is old news now
  }

  return {
    step: init.step,
    resumeAt: init.resumeAt,
    value,
    setValue: edit,
    update: (patch: Partial<StepDraft<S>>) =>
      edit((v) => ({ ...v, ...patch }) as StepDraft<S>),
    errorFor: (path: string) => errorMessageFor(errors, path),
    pending: pending ?? (leaving ? "complete" : null),
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
      if (!result) return;
      busyRef.current = true; // no second save while the next page loads
      setLeaving(true);
      router.push(`/onboarding/${result.next}`);
    },
    /** "Save draft", or "Save changes" on a completed step (full validation, stays completed). */
    async saveDraft(): Promise<boolean> {
      const result = await save(completed ? "complete" : "draft");
      if (result) setNotice({ kind: "saved", changes: completed });
      return result !== null;
    },
  };
}

/**
 * What the shared pieces (StepActions, RestoreBanner) need from any step's form. The value
 * accessors are left out on purpose: they are typed per step and would not be assignable here.
 */
export type StepForm = Omit<
  ReturnType<typeof useStepForm>,
  "value" | "setValue" | "update"
>;
