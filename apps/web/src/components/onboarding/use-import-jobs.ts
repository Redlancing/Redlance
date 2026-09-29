"use client";

import { useEffect, useRef, useState } from "react";
import type { ImportSummary } from "@/server/onboarding/imports";
import { adoptImports, isActiveImport as isActive } from "./import-status";

const POLL_MS = 1500;
/** After this long without every import finishing, stop and offer a way out. */
export const MAX_WAIT_MS = 60_000;

export type ImportStall = "slow" | "signed-out" | null;

type PollResult =
  ImportSummary | { id: string; gone: true } | "signed-out" | null;

function placeholder(id: string, kind: ImportSummary["kind"]): ImportSummary {
  return {
    id,
    kind,
    status: "queued",
    stage: "queued",
    errorCode: null,
    suggestions: null,
    partial: [],
    createdAt: new Date().toISOString(),
  };
}

async function pollJob(id: string): Promise<PollResult> {
  try {
    const res = await fetch(`/api/v1/onboarding/imports/${id}`, {
      cache: "no-store",
    });
    if (res.status === 401) return "signed-out";
    if (res.status === 404) return { id, gone: true };
    if (!res.ok) return null; // rate limited or a blip: try again next tick
    return { ...((await res.json()) as Omit<ImportSummary, "id">), id };
  } catch {
    return null;
  }
}

/** The user's latest imports, to find ones the worker started itself. Null on any error. */
async function fetchLatestImports(): Promise<ImportSummary[] | null> {
  try {
    const res = await fetch("/api/v1/onboarding", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { imports?: ImportSummary[] };
    return Array.isArray(body.imports) ? body.imports : null;
  } catch {
    return null;
  }
}

/**
 * Tracks import jobs and polls each queued/running one every 1.5 s (also in a hidden tab, so
 * the result is ready on return). When they all finish, it asks the server for imports it
 * isn't tracking yet (the worker starts a GitHub import from a link in the resume) and keeps
 * going until none are left; then `onSettled` runs once. After 60 s, or if the session ends,
 * polling stops and `stall` says why. State only changes in poll callbacks or during render
 * (when the `imports` prop brings new active jobs), never in an effect's synchronous body.
 */
export function useImportJobs(
  imports: ImportSummary[],
  onSettled?: (jobs: ImportSummary[]) => void,
) {
  const [jobs, setJobs] = useState(imports);
  const [stall, setStall] = useState<ImportStall>(null);
  const jobsRef = useRef(jobs);
  const onSettledRef = useRef(onSettled);
  const waitStartRef = useRef<number | null>(null);
  useEffect(() => {
    jobsRef.current = jobs;
    onSettledRef.current = onSettled;
  }, [jobs, onSettled]);

  // A refresh can bring imports we aren't following yet: adopt them (prev-prop comparison).
  const importsKey = imports.map((j) => `${j.id}:${j.status}`).join(",");
  const [seenKey, setSeenKey] = useState(importsKey);
  if (seenKey !== importsKey) {
    setSeenKey(importsKey);
    const adopted = adoptImports(jobs, imports);
    if (adopted) setJobs(adopted);
  }

  const activeIds = jobs
    .filter(isActive)
    .map((j) => j.id)
    .join(",");

  useEffect(() => {
    if (!activeIds || stall) return;
    const ids = activeIds.split(",");
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    waitStartRef.current ??= Date.now();

    async function poll() {
      const results = await Promise.all(ids.map(pollJob));
      if (cancelled) return;
      if (results.includes("signed-out")) {
        setStall("signed-out");
        return;
      }
      let next = jobsRef.current.map((job): ImportSummary => {
        const r = results.find(
          (u): u is Exclude<PollResult, "signed-out" | null> =>
            u !== null && u !== "signed-out" && u.id === job.id,
        );
        if (!r) return job;
        if ("gone" in r)
          return {
            ...job,
            status: "failed",
            stage: "failed",
            errorCode: "INTERNAL",
          };
        return { ...job, ...r };
      });
      if (!next.some(isActive)) {
        // Before calling it done, look for imports the worker started on its own.
        const latest = await fetchLatestImports();
        if (cancelled) return;
        next = (latest && adoptImports(next, latest)) ?? next;
      }
      jobsRef.current = next;
      setJobs(next);
      if (!next.some(isActive)) {
        waitStartRef.current = null;
        onSettledRef.current?.(next);
      } else if (
        Date.now() - (waitStartRef.current ?? Date.now()) >
        MAX_WAIT_MS
      ) {
        setStall("slow");
      } else timer = setTimeout(() => void poll(), POLL_MS);
    }

    timer = setTimeout(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeIds, stall]);

  return {
    jobs,
    /** Why polling stopped before every import finished, if it did. */
    stall,
    /** Starts following a new job; it replaces any earlier job of the same kind. */
    track(jobId: string, kind: ImportSummary["kind"]) {
      setStall(null);
      setJobs((current) => [
        ...current.filter((j) => j.kind !== kind),
        placeholder(jobId, kind),
      ]);
    },
    /** Forgets earlier results before a new import starts. */
    clear() {
      waitStartRef.current = null;
      setStall(null);
      setJobs([]);
    },
  };
}
