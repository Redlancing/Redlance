import { STEP_SCHEMAS, type StepDraft, type StepId } from "@redlance/core";

export const localCopyKey = (userId: string, step: StepId) =>
  `rl:onb:${userId}:${step}`;

export const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * A copy of unsaved form values kept in this browser. Offered back only when it was made from
 * the version the server still has, and differs from it.
 */
export function parseLocalCopy<S extends StepId>(
  raw: string | null,
  init: { step: S; version: number; data: unknown },
): StepDraft<S> | null {
  if (!raw) return null;
  try {
    const copy = JSON.parse(raw) as { version?: unknown; data?: unknown };
    if (copy.version !== init.version) return null;
    const schema = STEP_SCHEMAS[init.step].draft;
    const local = schema.safeParse(copy.data);
    const server = schema.safeParse(init.data);
    if (!local.success) return null;
    if (server.success && sameJson(local.data, server.data)) return null;
    return local.data as StepDraft<S>;
  } catch {
    return null;
  }
}

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, version: number, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ version, data }));
  } catch {
    // Storage full or blocked (private mode): the safety net is best-effort.
  }
}

export function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Same as above.
  }
}
