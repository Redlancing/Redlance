"use client";

import {
  AnimatePresence,
  LayoutGroup,
  motion,
  MotionConfig,
  type Transition,
} from "motion/react";
import { ArrowUpRightIcon, CheckIcon, FlagIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStory } from "./use-story";

// All posts, names and links below are sample content for the demos.

const ease: Transition["ease"] = [0.2, 0, 0, 1];

function MockCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-background text-left text-[13px] shadow-[0_24px_48px_-32px_rgb(26_21_18/0.35)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ Find */

const feed = [
  {
    id: "logo",
    hiring: true,
    title: "Logo for a Bengaluru coffee brand",
    sub: "r/DesignJobs",
  },
  {
    id: "fullstack",
    hiring: false,
    title: "Full-stack developer, 5 years, available now",
    sub: "r/forhire",
  },
  {
    id: "course",
    hiring: true,
    title: "Next.js developer to rebuild our course landing page",
    sub: "r/forhire",
  },
  {
    id: "ui",
    hiring: false,
    title: "UI designer taking new clients this month",
    sub: "r/DesignJobs",
  },
  {
    id: "shopify",
    hiring: true,
    title: "Speed up our Shopify checkout before the Diwali sale",
    sub: "r/hiring",
  },
];

export function FindMock() {
  const { ref, beat } = useStory(feed.length, { every: 800 });
  const visible = feed.slice(0, beat + 1).reverse();

  return (
    <MotionConfig reducedMotion="user">
      <div ref={ref} aria-hidden="true" className="mx-auto w-full max-w-xl">
        <MockCard>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">Hiring feed</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-flare-500 motion-reduce:animate-none" />
              Checked 1 min ago
            </span>
          </div>
          <ul className="h-[14.1rem] overflow-hidden [&>li:last-child]:border-b-0">
            <AnimatePresence initial={false}>
              {visible.map((post) => (
                <motion.li
                  key={post.id}
                  layout
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease }}
                  className="flex items-center gap-3 border-b border-border px-4 py-3"
                >
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium",
                      post.hiring
                        ? "bg-flare-50 text-flare-700"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {post.hiring ? "Hiring" : "For Hire"}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      post.hiring
                        ? "font-medium"
                        : "text-muted-foreground line-through decoration-muted-foreground/50",
                    )}
                  >
                    {post.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {post.hiring ? post.sub : "Skipped"}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </MockCard>
      </div>
    </MotionConfig>
  );
}

/* ----------------------------------------------------------------- Match */

const fields: [string, string][] = [
  ["Skills", "Next.js, Tailwind"],
  ["Posted budget", "$600, fixed"],
  ["Paid", "Yes"],
  ["Where", "Remote"],
  ["Deadline", "2 weeks"],
];

export function MatchMock() {
  const { ref, beat } = useStory(fields.length + 2, { every: 450 });
  const scored = beat === fields.length + 1;

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={ref}
        aria-hidden="true"
        className="mx-auto grid w-full max-w-3xl items-start gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      >
        <MockCard className="p-4">
          <p className="text-xs text-muted-foreground">r/forhire, 2 min ago</p>
          <p className="mt-1.5 text-sm leading-snug font-semibold">
            [Hiring] Next.js developer to rebuild our course landing page
          </p>
          <p className="mt-2 leading-relaxed text-muted-foreground">
            We sell online design courses and our landing page is slow and hard
            to update. Looking for someone to rebuild it in Next.js with
            Tailwind. Budget is $600, fixed. Ideally live in two weeks. Remote
            is fine.
          </p>
        </MockCard>
        <MockCard className="flex flex-col p-4">
          <p className="text-xs text-muted-foreground">What Redlance found</p>
          <dl className="mt-2 flex flex-col">
            {fields.map(([label, value], i) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-b-0"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium">
                  {beat > i ? (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                    >
                      {value}
                    </motion.span>
                  ) : (
                    <span className="text-muted-foreground/60">…</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex items-baseline gap-1.5">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">
              {scored ? "94" : "–"}
            </span>
            <span className="text-muted-foreground">/ 100 match</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full rounded-full bg-flare-500"
              initial={false}
              animate={{ width: scored ? "94%" : "0%" }}
              transition={{ duration: 0.8, ease }}
            />
          </div>
          <p className="mt-2 min-h-[2.6em] leading-snug text-muted-foreground">
            {scored
              ? "Next.js and Tailwind are your main stack, and you have shipped two edtech sites."
              : "Scoring against your profile…"}
          </p>
        </MockCard>
      </div>
    </MotionConfig>
  );
}

/* ----------------------------------------------------------------- Draft */

const drafts = {
  Comment: {
    before:
      "Hi! You want the course landing page rebuilt in Next.js. I shipped two edtech sites on the same stack this year: ",
    after:
      ". I can send a plan and a timeline today. When do you need it live?",
  },
  DM: {
    before:
      "Hi, I saw your post about the course landing page. I rebuilt a similar edtech site in Next.js and Tailwind last month (",
    after: "). Happy to share a quick plan. Is the current site on WordPress?",
  },
} as const;

export function DraftMock() {
  const { ref, beat } = useStory(2, { every: 2600, startAfter: 1800 });
  const tab = beat === 0 ? "Comment" : "DM";

  return (
    <MotionConfig reducedMotion="user">
      <div ref={ref} aria-hidden="true" className="mx-auto w-full max-w-xl">
        <MockCard className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-1 rounded-lg bg-muted p-1 text-xs font-medium">
              {(["Comment", "DM"] as const).map((name) => (
                <span
                  key={name}
                  className={cn(
                    "relative rounded-md px-2.5 py-1",
                    tab === name ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {tab === name && (
                    <motion.span
                      layoutId="draft-tab"
                      transition={{ duration: 0.35, ease }}
                      className="absolute inset-0 rounded-md bg-background shadow-xs"
                    />
                  )}
                  <span className="relative">{name}</span>
                </span>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">In your voice</span>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={tab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3, ease }}
              className="mt-3 min-h-[6.5rem] rounded-lg border border-border bg-cream/50 p-3 leading-relaxed"
            >
              {drafts[tab].before}
              <span className="rounded-sm bg-flare-50 px-0.5 font-medium text-flare-700">
                priya.dev/edtech
              </span>
              {drafts[tab].after}
            </motion.p>
          </AnimatePresence>
          <p className="mt-3 text-xs text-muted-foreground">
            Portfolio link picked for this post: Edtech landing page (Next.js)
          </p>
        </MockCard>
      </div>
    </MotionConfig>
  );
}

/* ------------------------------------------------------------------ Send */

export function SendMock() {
  const { ref, beat } = useStory(4, { every: 1100 });
  const rows = [
    {
      label: "Copy the reply",
      done: beat >= 1,
      action: beat >= 1 ? "Copied" : "Copy reply",
      primary: true,
    },
    {
      label: "Open the post",
      done: beat >= 2,
      action: "Open post",
      external: true,
    },
    { label: "Paste it and send", done: beat >= 3, action: "You do this part" },
  ];

  return (
    <MotionConfig reducedMotion="user">
      <div ref={ref} aria-hidden="true" className="mx-auto w-full max-w-xl">
        <MockCard>
          <ol>
            {rows.map((row, i) => (
              <li
                key={row.label}
                className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0"
              >
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors duration-300",
                    row.done
                      ? "bg-ink text-bone"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {row.done ? <CheckIcon className="size-3.5" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "flex-1 font-medium",
                    !row.done && "text-foreground/80",
                  )}
                >
                  {row.label}
                </span>
                <span
                  className={cn(
                    "inline-flex h-8 items-center gap-1 rounded-lg px-3 text-[13px] font-medium transition-colors duration-300",
                    row.primary
                      ? "bg-primary text-primary-foreground"
                      : row.external
                        ? "border border-input"
                        : "text-muted-foreground",
                  )}
                >
                  {row.action}
                  {row.external && <ArrowUpRightIcon className="size-3.5" />}
                </span>
              </li>
            ))}
          </ol>
        </MockCard>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          There is no auto-post button, in any plan.
        </p>
      </div>
    </MotionConfig>
  );
}

/* ----------------------------------------------------------------- Track */

type Column = "Sent" | "Replied" | "Hired" | "Paid";
const columns: Column[] = ["Sent", "Replied", "Hired", "Paid"];

const trackCards: {
  id: string;
  title: string;
  budget: string;
  column: Column;
  movesTo?: Column;
}[] = [
  {
    id: "shopify",
    title: "Shopify checkout speed fix",
    budget: "₹25,000",
    column: "Sent",
  },
  {
    id: "photo",
    title: "Portfolio site for a photographer",
    budget: "$350",
    column: "Sent",
  },
  {
    id: "course",
    title: "Next.js course landing page",
    budget: "$600",
    column: "Replied",
    movesTo: "Hired",
  },
  {
    id: "dashboard",
    title: "React dashboard performance",
    budget: "$40/hr",
    column: "Replied",
  },
  {
    id: "tea",
    title: "Landing page for a D2C tea brand",
    budget: "$450",
    column: "Paid",
  },
];

export function TrackMock() {
  const { ref, beat } = useStory(2, { every: 1000, startAfter: 1200 });

  const placed = trackCards.map((card) => ({
    ...card,
    column: beat >= 1 && card.movesTo ? card.movesTo : card.column,
  }));

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={ref}
        aria-hidden="true"
        className="mx-auto grid w-full max-w-3xl grid-cols-2 gap-2 md:grid-cols-4"
      >
        <LayoutGroup>
          {columns.map((column) => {
            const cards = placed.filter((c) => c.column === column);
            const good = column === "Hired" || column === "Paid";
            return (
              <div
                key={column}
                className="flex min-h-40 flex-col gap-2 rounded-xl bg-background/70 p-2 ring-1 ring-border"
              >
                <div className="flex items-center gap-1.5 px-1 pt-0.5 text-xs font-medium">
                  {column}
                  <span className="text-muted-foreground tabular-nums">
                    {cards.length}
                  </span>
                </div>
                {cards.map((card) => (
                  <motion.div
                    key={card.id}
                    layoutId={`track-${card.id}`}
                    transition={{ duration: 0.6, ease }}
                    className="rounded-lg border border-border bg-background p-2.5 text-[12.5px] shadow-xs"
                  >
                    <p className="leading-snug font-medium">{card.title}</p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-muted-foreground tabular-nums">
                        {card.budget}
                      </span>
                      {good && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-success-soft px-1.5 py-px text-[11px] font-medium text-success">
                          <CheckIcon className="size-3" />
                          {column}
                        </span>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            );
          })}
        </LayoutGroup>
      </div>
    </MotionConfig>
  );
}

/* ------------------------------------------------------ Small card visuals */

export function FlagChips() {
  return (
    <div aria-hidden="true" className="flex flex-wrap gap-1.5">
      {["Unpaid", "Equity only", "Free test task"].map((label) => (
        <span
          key={label}
          className="inline-flex items-center gap-1 rounded-md bg-danger-soft px-1.5 py-0.5 text-xs font-medium text-danger"
        >
          <FlagIcon className="size-3" />
          {label}
        </span>
      ))}
    </div>
  );
}
