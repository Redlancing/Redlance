import { cn } from "@/lib/utils";

// Subreddit insights visuals. Everything here is derived from data an RSS
// feed provides (post time, title, body, subreddit), so it can be built for
// real. The numbers shown are sample data and are labelled as such.

const card =
  "rounded-xl border border-border bg-background p-4 text-left text-[12px] shadow-[0_24px_48px_-32px_rgb(26_21_18/0.35)]";

/* ------------------------------------------------ Hiring posts per week */

const weekly = {
  forhire: [38, 41, 40, 44, 42, 46, 45, 48],
  hireaprogrammer: [16, 15, 17, 19, 18, 19, 18, 20],
};

function toPath(values: number[]) {
  return values
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${(28 + (i * 264) / 7).toFixed(1)} ${(100 - v * 1.7).toFixed(1)}`,
    )
    .join(" ");
}

function WeeklyChart() {
  const forhire = toPath(weekly.forhire);
  return (
    <figure className={card}>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold">Hiring posts per week</span>
        <span className="text-muted-foreground">Sample data</span>
      </div>
      <div className="mt-2 flex gap-3 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-flare-500" />
          r/forhire
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-stone" />
          r/hireaprogrammer
        </span>
      </div>
      <svg viewBox="0 0 300 112" className="mt-2 w-full overflow-visible">
        {[0, 25, 50].map((v) => (
          <g key={v}>
            <line
              x1="28"
              x2="292"
              y1={100 - v * 1.7}
              y2={100 - v * 1.7}
              strokeDasharray="2 3"
              className="stroke-border"
            />
            <text
              x="0"
              y={103 - v * 1.7}
              className="fill-muted-foreground text-[8px]"
            >
              {v}
            </text>
          </g>
        ))}
        <path
          d={`${forhire} L292 100 L28 100 Z`}
          className="animate-enter fill-flare-500/10 [animation-delay:0.8s]"
        />
        <path
          d={forhire}
          fill="none"
          strokeWidth="2"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray="1"
          className="animate-draw stroke-flare-500 [animation-duration:1.6s]"
        />
        <path
          d={toPath(weekly.hireaprogrammer)}
          fill="none"
          strokeWidth="2"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray="1"
          className="animate-draw stroke-stone [animation-delay:0.25s] [animation-duration:1.6s]"
        />
        <text x="28" y="111" className="fill-muted-foreground text-[8px]">
          8 weeks ago
        </text>
        <text
          x="292"
          y="111"
          textAnchor="end"
          className="fill-muted-foreground text-[8px]"
        >
          This week
        </text>
      </svg>
    </figure>
  );
}

/* ---------------------------------------- This month, stacked by subreddit */

const monthly = [
  { sub: "forhire", match: 58, other: 96, flagged: 18 },
  { sub: "hiring", match: 31, other: 64, flagged: 14 },
  { sub: "hireaprogrammer", match: 36, other: 30, flagged: 6 },
  { sub: "DesignJobs", match: 9, other: 88, flagged: 21 },
  { sub: "freelance_forhire", match: 17, other: 40, flagged: 12 },
];
const MAX = 180;

function MonthlyBars() {
  return (
    <figure className={card}>
      <span className="text-[13px] font-semibold">Hiring posts this month</span>
      <div className="mt-2 flex flex-wrap gap-3 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-flare-500" />
          Match your skills
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-feed" />
          Other hiring
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-danger/70" />
          Red-flagged
        </span>
      </div>
      <div className="mt-4 flex h-40 items-end gap-3 border-b border-border">
        {monthly.map((row, i) => {
          const total = row.match + row.other + row.flagged;
          return (
            <div
              key={row.sub}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
            >
              <span className="mb-1 text-center text-[10px] text-muted-foreground tabular-nums">
                {total}
              </span>
              <div
                className="flex origin-bottom animate-grow-y flex-col-reverse overflow-hidden rounded-t-md"
                style={{
                  height: `${(total / MAX) * 100}%`,
                  animationDelay: `${0.15 + i * 0.1}s`,
                }}
              >
                <div
                  className="bg-flare-500"
                  style={{ height: `${(row.match / total) * 100}%` }}
                />
                <div
                  className="bg-feed"
                  style={{ height: `${(row.other / total) * 100}%` }}
                />
                <div
                  className="bg-danger/70"
                  style={{ height: `${(row.flagged / total) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-3">
        {monthly.map((row) => (
          <span
            key={row.sub}
            className="min-w-0 flex-1 truncate text-center text-[10px] text-muted-foreground"
          >
            r/{row.sub}
          </span>
        ))}
      </div>
    </figure>
  );
}

/* --------------------------------------------------- Where to focus card */

const focus = [
  {
    sub: "r/forhire",
    tone: "high",
    label: "High potential",
    points: [
      "43 hiring posts a week, 34% match you",
      "Median posted budget $450",
    ],
  },
  {
    sub: "r/hireaprogrammer",
    tone: "high",
    label: "High potential",
    points: [
      "Quieter, but half the posts match you",
      "Median posted budget $300",
    ],
  },
  {
    sub: "r/DesignJobs",
    tone: "low",
    label: "Low for you",
    points: ["Busy, but only 8% match your skills"],
  },
];

function FocusCard() {
  return (
    <figure className={cn(card, "flex h-full flex-col")}>
      <span className="text-[13px] font-semibold">
        Where to focus this week
      </span>
      <span className="text-muted-foreground">
        Based on the last 30 days of posts
      </span>
      <ol className="mt-4 mb-5 flex flex-col gap-4">
        {focus.map((item, i) => (
          <li
            key={item.sub}
            className="animate-enter"
            style={{ animationDelay: `${0.5 + i * 0.25}s` }}
          >
            <p className="flex items-center gap-2 text-[13px] font-semibold">
              {i + 1}. {item.sub}
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[11px] font-medium",
                  item.tone === "high"
                    ? "bg-flare-50 text-flare-700"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    item.tone === "high" ? "bg-flare-500" : "bg-stone",
                  )}
                />
                {item.label}
              </span>
            </p>
            <ul className="mt-1.5 flex flex-col gap-1 pl-4 text-muted-foreground">
              {item.points.map((p) => (
                <li key={p} className="list-disc">
                  {p}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <p
        className="mt-auto animate-enter rounded-lg border border-flare-500/25 bg-flare-50 p-3 leading-relaxed text-flare-700"
        style={{ animationDelay: "1.4s" }}
      >
        <span className="font-semibold">Tip:</span> most r/forhire hiring posts
        land between 8pm and 1am IST. Keep instant alerts on in those hours.
      </p>
    </figure>
  );
}

/** The Insights step's main visual, laid out like Attio's reporting cards. */
export function InsightsMock() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto grid w-full max-w-4xl grid-cols-1 items-stretch gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <WeeklyChart />
        <MonthlyBars />
      </div>
      <FocusCard />
    </div>
  );
}

/* ----------------------------------------------------- Sub-card visuals */

const hours = [
  15, 10, 7, 5, 4, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 8, 9, 10, 12, 14, 17, 19, 18,
  16,
];
const peak = new Set([20, 21, 22, 23, 0]);

/** Hiring posts by hour of day, in IST. */
export function PeakHours() {
  return (
    <figure aria-hidden="true" className="w-full max-w-[22rem] text-[11px]">
      <div className="flex h-24 items-end gap-[3px]">
        {hours.map((v, h) => (
          <span
            key={h}
            className={cn(
              "flex-1 origin-bottom animate-grow-y rounded-t-[2px]",
              peak.has(h) ? "bg-flare-500" : "bg-feed",
            )}
            style={{
              height: `${(v / 19) * 100}%`,
              animationDelay: `${h * 0.03}s`,
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-muted-foreground">
        <span>12am</span>
        <span>6am</span>
        <span>12pm</span>
        <span>6pm</span>
        <span>11pm</span>
      </div>
      <p className="mt-2 font-medium text-flare-700">Peak: 8pm to 1am IST</p>
    </figure>
  );
}

const budgets = [
  { sub: "r/forhire", low: 250, high: 900, median: 450 },
  { sub: "r/hireaprogrammer", low: 150, high: 600, median: 300 },
  { sub: "r/DesignJobs", low: 60, high: 300, median: 150 },
];

/** Middle half of posted budgets per subreddit, with the median marked. */
export function BudgetRanges() {
  return (
    <figure aria-hidden="true" className="w-full max-w-[24rem] text-[11px]">
      <div className="flex flex-col gap-3">
        {budgets.map((b, i) => (
          <div
            key={b.sub}
            className="grid grid-cols-[7.5rem_minmax(0,1fr)_2.5rem] items-center gap-2"
          >
            <span className="truncate font-medium">{b.sub}</span>
            <span className="relative h-2 rounded-full bg-muted">
              <span
                className="absolute inset-y-0 origin-left animate-grow-x rounded-full bg-flare-500/35"
                style={{
                  left: `${b.low / 10}%`,
                  width: `${(b.high - b.low) / 10}%`,
                  animationDelay: `${0.1 + i * 0.15}s`,
                }}
              />
              <span
                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 animate-enter rounded-full bg-flare-600 ring-2 ring-background"
                style={{
                  left: `${b.median / 10}%`,
                  animationDelay: `${0.7 + i * 0.15}s`,
                }}
              />
            </span>
            <span className="text-right tabular-nums">${b.median}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-[7.5rem_minmax(0,1fr)_2.5rem] gap-2 text-muted-foreground">
        <span />
        <span className="flex justify-between">
          <span>$0</span>
          <span>$500</span>
          <span>$1k</span>
        </span>
        <span className="text-right">median</span>
      </div>
    </figure>
  );
}
