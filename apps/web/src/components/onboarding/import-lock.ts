"use client";

import { useSyncExternalStore } from "react";

// Whether the Import step is waiting on an import. The progress bar lives in the server-rendered
// page, outside the step's component tree, so the two share this tiny store.
let locked = false;
const listeners = new Set<() => void>();

export function setImportLock(value: boolean) {
  if (locked === value) return;
  locked = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useImportLock(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => locked,
    () => false,
  );
}
