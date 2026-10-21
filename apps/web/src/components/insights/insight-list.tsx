import type { InsightsListRow } from "@redlance/core";
import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { listRowView, type Cell, type ListRowView } from "@/lib/insights-view";
import { cn } from "@/lib/utils";

// The subreddit list: a table-like column of rows. On a phone each row stacks its numbers
// under the name, with their labels written out; from `md` the numbers sit in columns under
// one header row (screen readers get each label inline, the header is hidden from them).

const GRID = {
  personal: "md:grid-cols-[minmax(0,1fr)_6.5rem_11rem_9.5rem_5.5rem_4.5rem]",
  all: "md:grid-cols-[minmax(0,1fr)_6.5rem_9.5rem_5.5rem]",
} as const;

function Quiet({ cell }: { cell: { ok: false; quiet: string } }) {
  return (
    <span className="text-muted-foreground" title={cell.quiet}>
      <span aria-hidden="true">–</span>
      <span className="sr-only">{cell.quiet}</span>
    </span>
  );
}

/** A value with its label: shown after the value on a phone, read aloud everywhere. */
function Labelled({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={className}>
      {children}
      <span className="text-stone md:sr-only"> {label}</span>
    </span>
  );
}

function ValueCell<T>({
  cell,
  label,
  render,
}: {
  cell: Cell<T>;
  label: string;
  render: (v: T) => React.ReactNode;
}) {
  return (
    <span className={cn("md:text-right", !cell.ok && "max-md:hidden")}>
      {cell.ok ? (
        <Labelled label={label}>{render(cell.value)}</Labelled>
      ) : (
        <Quiet cell={cell} />
      )}
    </span>
  );
}

function Row({ v, personal }: { v: ListRowView; personal: boolean }) {
  const showDisplay = v.displayName.toLowerCase() !== v.name.toLowerCase();
  return (
    <li>
      {/* No viewport prefetch: Browse all has ~240 rows, each would fetch a loading state. */}
      <Link
        href={v.href}
        prefetch={false}
        className={cn(
          "grid gap-x-4 gap-y-1 px-1 py-3 text-sm tabular-nums outline-none hover:bg-bone/50 focus-visible:bg-bone focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset md:items-center md:py-2.5",
          personal ? GRID.personal : GRID.all,
        )}
      >
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium text-foreground">
            r/{v.name}
          </span>
          {showDisplay && (
            <span className="block truncate text-[13px] text-stone">
              {v.displayName}
            </span>
          )}
        </span>
        {/* Phone: the numbers wrap on one line under the name. md: `contents` drops this
            wrapper so each value lands in its own grid column. */}
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-foreground md:contents md:text-sm">
          <ValueCell
            cell={v.perWeek}
            label="a week"
            render={(w) => (
              <>
                {w.text}
                {w.trend && (
                  <span
                    className="ml-1 inline-flex align-[-2px] text-stone"
                    title={`From ${w.prev}`}
                  >
                    {w.trend === "up" ? (
                      <ArrowUp className="size-3.5" aria-hidden="true" />
                    ) : (
                      <ArrowDown className="size-3.5" aria-hidden="true" />
                    )}
                    <span className="sr-only">
                      {w.trend === "up" ? "up" : "down"} from {w.prev}
                    </span>
                  </span>
                )}
              </>
            )}
          />
          {personal && v.fit && (
            <span className={cn(!v.fit.ok && "max-md:hidden")}>
              {v.fit.ok ? v.fit.value : <Quiet cell={v.fit} />}
            </span>
          )}
          <ValueCell cell={v.budget} label="posted budget" render={(b) => b} />
          <ValueCell
            cell={v.redFlags}
            label="red flags"
            render={(r) => (
              <span className={r.danger ? "font-medium text-danger" : ""}>
                {r.text}
              </span>
            )}
          />
          {personal && v.matches !== null && (
            <Labelled
              label={v.matches === 1 ? "match" : "matches"}
              className="md:text-right"
            >
              {v.matches}
            </Labelled>
          )}
        </span>
      </Link>
    </li>
  );
}

export function InsightList({
  rows,
  personal,
}: {
  rows: InsightsListRow[];
  personal: boolean;
}) {
  const head = "text-xs font-medium text-stone";
  return (
    <div className="mt-2">
      <div
        aria-hidden="true"
        className={cn(
          "hidden gap-x-4 border-b border-border px-1 pb-2 md:grid",
          personal ? GRID.personal : GRID.all,
        )}
      >
        <span className={head}>Subreddit</span>
        <span className={cn(head, "text-right")}>A week</span>
        {personal && <span className={head}>Fits you</span>}
        <span className={cn(head, "text-right")}>Posted budget</span>
        <span className={cn(head, "text-right")}>Red flags</span>
        {personal && <span className={cn(head, "text-right")}>Matches</span>}
      </div>
      <ul className="divide-y divide-border border-b border-border max-md:border-t">
        {rows.map((r) => (
          <Row key={r.subreddit} v={listRowView(r)} personal={personal} />
        ))}
      </ul>
    </div>
  );
}
