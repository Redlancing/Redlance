import { Skeleton } from "@/components/ui/skeleton";

// Same shape as the list: title, tabs, a header row and fixed-height rows (no layout shift).
export default function InsightsLoading() {
  return (
    <div className="mx-auto max-w-5xl" aria-busy="true">
      <span className="sr-only">Loading insights</span>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        Insights
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        How each subreddit hires, from the last 28 days of posts.
      </p>
      <div className="mt-6 flex h-9 gap-3 border-b border-border">
        <Skeleton className="h-4 w-12 self-center" />
        <Skeleton className="h-4 w-20 self-center" />
      </div>
      <Skeleton className="mt-4 h-4 w-72 max-w-full" />
      <ul className="mt-4 divide-y divide-border border-y border-border">
        {Array.from({ length: 8 }, (_, i) => (
          <li
            key={i}
            className="flex h-[66px] flex-col justify-center gap-2 px-1 md:h-[45px] md:flex-row md:items-center md:justify-between"
          >
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3.5 w-56 max-w-full md:w-[26rem]" />
          </li>
        ))}
      </ul>
    </div>
  );
}
