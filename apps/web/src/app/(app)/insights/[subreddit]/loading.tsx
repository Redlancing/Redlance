import { Skeleton } from "@/components/ui/skeleton";

// The detail page's frame: header, two fact ledgers, the hours chart.
function Ledger({ rows }: { rows: number }) {
  return (
    <div className="mt-3 divide-y divide-border border-y border-border">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-[46px] items-center gap-4">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-4 w-48 max-w-[50%]" />
        </div>
      ))}
    </div>
  );
}

export default function SubredditInsightsLoading() {
  return (
    <div className="mx-auto max-w-5xl" aria-busy="true">
      <span className="sr-only">Loading insights</span>
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-3 h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-40" />
      <div className="grid gap-x-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="mt-8">
          <Skeleton className="h-5 w-28" />
          <Ledger rows={5} />
          <Skeleton className="mt-10 h-5 w-40" />
          <Skeleton className="mt-4 h-28 w-full" />
        </div>
        <div className="mt-10 lg:mt-8">
          <Skeleton className="h-5 w-44" />
          <Ledger rows={3} />
        </div>
      </div>
    </div>
  );
}
