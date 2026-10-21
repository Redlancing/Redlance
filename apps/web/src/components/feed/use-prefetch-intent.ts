"use client";

import { useRouter } from "next/navigation";
// The enum behind `router.prefetch`'s public `kind` option (Next doesn't re-export it). An internal
// path on purpose: if an upgrade moves or removes it, the build fails loudly. If Next drops it,
// switch to a `<Link prefetch>` that turns on at intent (`prefetch={intended ? true : false}`).
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { useMemo } from "react";
import {
  canPrefetch,
  createPrefetchScheduler,
  type PrefetchScheduler,
} from "./prefetch-intent";

// One per tab, so the rate limit and the "already prefetched" memory outlive a remount.
let scheduler: PrefetchScheduler | null = null;

/** Checked at the moment of intent: a window can move to another screen, data saver can flip. */
function deviceAllows(): boolean {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  return canPrefetch({
    hoverFine: window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    saveData: connection?.saveData,
  });
}

/**
 * Prefetches a match page once the user shows intent (see prefetch-intent.ts). A full prefetch:
 * Next keeps the whole page for `staleTimes.static` (5 min), so the click renders from the
 * client cache without a server trip, and the page's staleness guard (`loadedAt`) checks old
 * data in the background. Rendering a match page only reads; "seen" is marked by the page's
 * effect after it mounts, never by a prefetch.
 */
export function usePrefetchIntent(): {
  /** `href` is the row's link (with the list's filters): Next caches each URL separately. */
  intend: (href: string) => void;
  cancel: (href: string) => void;
} {
  const router = useRouter();
  return useMemo(
    () => ({
      intend(href) {
        if (!deviceAllows()) return;
        scheduler ??= createPrefetchScheduler();
        scheduler.intend(href, (onInvalidate) =>
          router.prefetch(href, { kind: PrefetchKind.FULL, onInvalidate }),
        );
      },
      cancel(href) {
        scheduler?.cancel(href);
      },
    }),
    [router],
  );
}
