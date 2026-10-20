"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The split view: the match list on the left, the open match on the right. On a phone the two
 * are separate screens: the list at /feed, only the match at /feed/<id>.
 */
export function FeedShell({
  list,
  children,
}: {
  list: React.ReactNode;
  children: React.ReactNode;
}) {
  const open = useSelectedLayoutSegment() !== null;
  return (
    <div className="-mx-4 -mt-8 sm:-mx-8 md:-mb-8 md:flex md:h-svh lg:-mx-12">
      <section
        aria-label="Match list"
        className={cn(
          "border-border md:w-[400px] md:shrink-0 md:overflow-y-auto md:border-r lg:w-[440px]",
          open && "hidden md:block",
        )}
      >
        {list}
      </section>
      <div
        className={cn(
          "min-w-0 flex-1 md:overflow-y-auto",
          !open && "hidden md:block",
        )}
      >
        {children}
      </div>
    </div>
  );
}
