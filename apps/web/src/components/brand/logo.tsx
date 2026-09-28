import { cn } from "@/lib/utils";

/** The "feed pick" mark: three feed lines, the right gig picked out in Flare orange. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cn("size-8 shrink-0", className)}
    >
      <rect x="6" y="11" width="34" height="8" rx="4" className="fill-feed" />
      <path
        d="M11 27H44L62 32L44 37H11A5 5 0 0 1 11 27Z"
        className="fill-flare-500"
      />
      <rect x="6" y="45" width="24" height="8" rx="4" className="fill-feed" />
    </svg>
  );
}

/** Mark + wordmark lockup. Size it with a text-* class; the mark scales with it. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.24em] font-wordmark leading-none font-bold tracking-[-0.035em]",
        className,
      )}
    >
      <LogoMark className="size-[1.15em]" />
      Redlance
    </span>
  );
}
