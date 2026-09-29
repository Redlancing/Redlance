"use client";

import { useEffect, useRef, useState } from "react";
import type { ImportSummary } from "@/server/onboarding/imports";

const POLL_MS = 1500;

const isActive = (j: ImportSummary) =>
  j.status === "queued" || j.status === "running";

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

/**
 * Tracks import jobs and polls each queued/running one every 1.5 s (also in a hidden tab, so
 * the result is ready on return). Polling stops once every job is done or failed; `onSettled`
 * then runs once with the final jobs. State only changes in poll callbacks, never in an
 * effect's synchronous body.
 */
export function useImportJobs(
  initial: ImportSummary[],
  onSettled?: (jobs: ImportSummary[]) => void,
) {
  const [jobs, setJobs] = useState(initial);
  const jobsRef = useRef(jobs);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    jobsRef.current = jobs;
    onSettledRef.current = onSettled;
  }, [jobs, onSettled]);

  const activeIds = jobs
    .filter(isActive)
    .map((j) => j.id)
    .join(",");

  useEffect(() => {
    if (!activeIds) return;
    const ids = activeIds.split(",");
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      const updates = await Promise.all(
        ids.map(
          async (
            id,
          ): Promise<ImportSummary | { id: string; gone: true } | null> => {
            try {
              const res = await fetch(`/api/v1/onboarding/imports/${id}`, {
                cache: "no-store",
              });
              if (res.status === 404) return { id, gone: true };
              if (!res.ok) return null; // rate limited or a blip: try again next tick
              return {
                ...((await res.json()) as Omit<ImportSummary, "id">),
                id,
              };
            } catch {
              return null;
            }
          },
        ),
      );
      if (cancelled) return;
      const apply = (list: ImportSummary[]) =>
        list.map((job): ImportSummary => {
          const update = updates.find((u) => u?.id === job.id);
          if (!update) return job;
          if ("gone" in update)
            return {
              ...job,
              status: "failed",
              stage: "failed",
              errorCode: "INTERNAL",
            };
          return { ...job, ...update };
        });
      const next = apply(jobsRef.current);
      jobsRef.current = next;
      setJobs(apply);
      if (next.length && !next.some(isActive)) onSettledRef.current?.(next);
      else timer = setTimeout(() => void poll(), POLL_MS);
    }

    timer = setTimeout(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeIds]);

  return {
    jobs,
    /** Starts following a new job; it replaces any earlier job of the same kind. */
    track(jobId: string, kind: ImportSummary["kind"]) {
      setJobs((current) => [
        ...current.filter((j) => j.kind !== kind),
        placeholder(jobId, kind),
      ]);
    },
    /** Forgets earlier results before a new import starts. */
    clear() {
      setJobs([]);
    },
  };
}
