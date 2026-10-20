"use client";

import { useEffect, useRef } from "react";
import { createPoller, type PollerOptions } from "./poll";

type UsePollOptions<T> = Omit<PollerOptions<T>, "clock"> & {
  /** Poll only while true (default true). Turning it off stops and resets the schedule. */
  enabled?: boolean;
};

/**
 * Runs `fn` on an interval while `enabled`, with no overlapping calls, until `isDone` or the
 * timeout. Pauses while the tab is hidden and resumes when it is visible again. The latest
 * callbacks are always used; the schedule restarts only when `enabled` or the timings change.
 */
export function usePoll<T>(options: UsePollOptions<T>): void {
  const { enabled = true, intervalMs, firstDelayMs, timeoutMs } = options;
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!enabled) return;
    const poller = createPoller<T>({
      intervalMs,
      firstDelayMs,
      timeoutMs,
      fn: () => latest.current.fn(),
      isDone: (v) => latest.current.isDone(v),
      onResult: (v) => latest.current.onResult?.(v),
      onTimeout: () => latest.current.onTimeout?.(),
    });
    function onVisibility() {
      if (document.visibilityState === "hidden") poller.pause();
      else poller.resume();
    }
    if (document.visibilityState === "hidden") poller.pause();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      poller.stop();
    };
  }, [enabled, intervalMs, firstDelayMs, timeoutMs]);
}
