import { BellIcon, CheckIcon, LockIcon, XIcon } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

// Small decorative illustrations for the sub-cards. CSS-animated; wrap them in
// <InView> so they start when visible. All content is sample content.

const chip =
  "rounded-md border border-border bg-background px-1.5 py-0.5 text-xs font-medium whitespace-nowrap shadow-xs";

/* Radar: the logo in the middle, pulsing rings, subreddits floating around. */
export function Radar({
  chips = [
    "r/forhire",
    "r/DesignJobs",
    "r/HireaWriter",
    "r/VideoEditingRequests",
  ],
  className,
}: {
  chips?: string[];
  className?: string;
}) {
  const spots = [
    "top-3 left-0",
    "top-9 right-0",
    "bottom-9 left-3",
    "bottom-2 right-6",
  ];
  return (
    <div
      aria-hidden="true"
      className={cn("relative mx-auto size-56", className)}
    >
      <div className="absolute inset-0 rounded-full border border-border" />
      <div className="absolute inset-[15%] rounded-full border border-border" />
      <div className="absolute inset-[30%] rounded-full border border-border" />
      {[0, 1.2, 2.4].map((delay) => (
        <div
          key={delay}
          className="absolute inset-[8%] animate-radar rounded-full border border-flare-500/50"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
      <div className="absolute inset-[38%] grid place-items-center rounded-full bg-background shadow-md ring-1 ring-border">
        <LogoMark className="size-7" />
      </div>
      {chips.slice(0, 4).map((label, i) => (
        <span
          key={label}
          className={cn(
            "absolute animate-bob",
            chip,
            spots[i],
            i === 0 && "border-flare-500/40 bg-flare-50 text-flare-700",
          )}
          style={{ animationDelay: `${i * -1.1}s` }}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

/* Hiring posts pass, [For Hire] posts are dropped. */
export function FilterIllustration() {
  return (
    <div
      aria-hidden="true"
      className="grid w-full max-w-[26rem] grid-cols-2 gap-3 text-xs"
    >
      <div className="flex flex-col gap-1.5">
        {["Designer, taking new clients", "Full-stack dev, 5 years"].map(
          (t) => (
            <span
              key={t}
              className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-muted-foreground line-through decoration-muted-foreground/60"
            >
              <XIcon className="size-3 shrink-0" />
              <span className="truncate">{t}</span>
            </span>
          ),
        )}
        <span className="text-muted-foreground">Skipped: [For Hire]</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {["Logo for a coffee brand", "Shopify checkout fix"].map((t) => (
          <span
            key={t}
            className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 font-medium shadow-xs"
          >
            <CheckIcon className="size-3 shrink-0 text-flare-600" />
            <span className="truncate">{t}</span>
          </span>
        ))}
        <span className="text-muted-foreground">Kept: [Hiring]</span>
      </div>
    </div>
  );
}

/* Minimum budget slider settling into place, and a switch that is on. */
export function RulesIllustration() {
  return (
    <div
      aria-hidden="true"
      className="flex w-full max-w-[20rem] flex-col gap-4 rounded-xl border border-border bg-background p-4 text-sm shadow-xs"
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Minimum posted budget</span>
          <span className="font-medium tabular-nums">₹5,000</span>
        </div>
        <div
          className="relative h-1.5 rounded-full bg-muted"
          style={{ "--thumb-to": "58%" } as React.CSSProperties}
        >
          <div className="absolute inset-y-0 left-0 animate-slide-fill rounded-full bg-flare-500" />
          <div className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 animate-slide-thumb rounded-full border border-border bg-background shadow-sm" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Skip unpaid posts</span>
        <span className="flex h-5 w-9 items-center rounded-full bg-ink p-0.5">
          <span className="ml-auto size-4 rounded-full bg-background" />
        </span>
      </div>
    </div>
  );
}

/* One reply, two versions. */
export function BubblesIllustration() {
  return (
    <div
      aria-hidden="true"
      className="relative h-32 w-full max-w-[22rem] text-xs leading-relaxed"
    >
      <div className="absolute top-0 left-0 w-[78%] animate-bob rounded-xl rounded-bl-sm border border-border bg-background p-2.5 shadow-sm">
        <span className="font-medium">Comment</span>
        <p className="mt-0.5 text-muted-foreground">
          You want the landing page rebuilt in Next.js…
        </p>
      </div>
      <div
        className="absolute right-0 bottom-0 w-[78%] animate-bob rounded-xl rounded-br-sm border border-border bg-cream p-2.5 shadow-sm"
        style={{ animationDelay: "-2.2s" }}
      >
        <span className="font-medium">DM</span>
        <p className="mt-0.5 text-muted-foreground">
          Hi, I saw your post about the landing page…
        </p>
      </div>
    </div>
  );
}

/* The closest portfolio piece is picked. */
export function PortfolioPick() {
  const items = [
    { title: "Edtech landing page", tag: "Next.js", pick: true },
    { title: "Restaurant booking app", tag: "React Native" },
    { title: "Photographer portfolio", tag: "Framer" },
  ];
  return (
    <ul
      aria-hidden="true"
      className="flex w-full max-w-[20rem] flex-col gap-1.5 text-sm"
    >
      {items.map((item) => (
        <li
          key={item.title}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2",
            item.pick
              ? "border-flare-500/40 bg-flare-50"
              : "border-border bg-background text-muted-foreground",
          )}
        >
          <span className={cn("font-medium", item.pick && "text-foreground")}>
            {item.title}
          </span>
          <span className="text-xs text-muted-foreground">{item.tag}</span>
          {item.pick && <CheckIcon className="ml-auto size-4 text-flare-600" />}
        </li>
      ))}
    </ul>
  );
}

/* There is no auto-post switch to turn on. */
export function LockedToggle() {
  return (
    <div
      aria-hidden="true"
      className="flex w-full max-w-[20rem] flex-col gap-2 rounded-xl border border-border bg-background p-4 text-sm shadow-xs"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium">
          <LockIcon className="size-4 text-muted-foreground" />
          Auto-post replies
        </span>
        <span className="flex h-5 w-9 items-center rounded-full bg-muted p-0.5">
          <span className="size-4 rounded-full bg-background shadow-xs" />
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Not available, in any plan.
      </p>
    </div>
  );
}

/* A ring that draws to just under two minutes. */
export function Stopwatch() {
  return (
    <div aria-hidden="true" className="flex items-center gap-4">
      <div className="relative size-24">
        <svg viewBox="0 0 80 80" className="size-full -rotate-90">
          <circle
            cx="40"
            cy="40"
            r="34"
            fill="none"
            strokeWidth="5"
            className="stroke-muted"
          />
          <circle
            cx="40"
            cy="40"
            r="34"
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="0.93 2"
            className="animate-draw stroke-flare-500 [animation-duration:1.8s]"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-lg font-semibold tabular-nums">1:52</span>
        </div>
      </div>
      <div className="text-sm">
        <p className="font-medium">Alert to reply</p>
        <p className="text-muted-foreground">Read, edit, send.</p>
      </div>
    </div>
  );
}

/* A nudge when a client goes quiet. */
export function FollowUpNudge() {
  return (
    <div
      aria-hidden="true"
      className="flex w-full max-w-[20rem] animate-bob items-start gap-3 rounded-xl border border-border bg-background p-3 text-sm shadow-sm"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-flare-50 text-flare-600">
        <BellIcon className="size-4" />
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">No reply in 3 days</span>
        <span className="text-muted-foreground">
          Send a short follow-up to the Shopify client?
        </span>
      </div>
    </div>
  );
}

/* Hire rate appears only after enough replies, then draws in. */
export function InsightsChart() {
  const points: [number, number][] = [
    [96, 84],
    [116, 80],
    [136, 82],
    [156, 72],
    [176, 68],
    [196, 62],
    [216, 64],
    [236, 52],
    [256, 48],
    [276, 40],
  ];
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const area = `${line} L276 104 L96 104 Z`;
  return (
    <figure
      aria-hidden="true"
      className="w-full max-w-[20rem] rounded-xl border border-border bg-background p-3 text-xs shadow-xs"
    >
      <div className="flex items-baseline justify-between">
        <span className="font-medium">Hire rate</span>
        <span className="text-muted-foreground">sample account</span>
      </div>
      <svg viewBox="0 0 280 112" className="mt-2 w-full overflow-visible">
        <rect
          x="0"
          y="8"
          width="92"
          height="96"
          rx="6"
          className="fill-muted"
        />
        <text
          x="46"
          y="58"
          textAnchor="middle"
          className="fill-muted-foreground text-[9px]"
        >
          Under 20
        </text>
        <text
          x="46"
          y="70"
          textAnchor="middle"
          className="fill-muted-foreground text-[9px]"
        >
          replies
        </text>
        <line
          x1="96"
          y1="8"
          x2="96"
          y2="104"
          strokeDasharray="3 3"
          className="stroke-border"
          strokeWidth="1"
        />
        <line
          x1="0"
          y1="104"
          x2="280"
          y2="104"
          className="stroke-border"
          strokeWidth="1"
        />
        <path d={area} className="fill-flare-500/10" />
        <path
          d={line}
          fill="none"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1"
          className="animate-draw stroke-flare-500 [animation-delay:0.2s] [animation-duration:1.8s]"
        />
        <circle cx="276" cy="40" r="3.5" className="fill-flare-500" />
        <text
          x="272"
          y="30"
          textAnchor="end"
          className="fill-foreground text-[10px] font-semibold"
        >
          18%
        </text>
      </svg>
    </figure>
  );
}
