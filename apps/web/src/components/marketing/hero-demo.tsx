"use client";

import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useInView,
  useReducedMotion,
  type Transition,
} from "motion/react";
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  FlagIcon,
  InboxIcon,
  KanbanSquareIcon,
  PenLineIcon,
  SendIcon,
  UserRoundIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Sample data for the demo only; nothing here is a real post or a real user.
type DemoPost = {
  id: string;
  title: string;
  subreddit: string;
  budget: string;
  age: string;
  score: number;
  reason: string;
  flag?: string;
};

const posts: DemoPost[] = [
  {
    id: "nextjs",
    title: "Next.js developer to rebuild our course landing page",
    subreddit: "r/forhire",
    budget: "$600",
    age: "2m",
    score: 94,
    reason: "Next.js and Tailwind are your main stack",
  },
  {
    id: "shopify",
    title: "Speed up our Shopify checkout before the Diwali sale",
    subreddit: "r/hiring",
    budget: "₹25,000",
    age: "6m",
    score: 88,
    reason: "You list Shopify speed work",
  },
  {
    id: "react",
    title: "React dashboard is slow, need someone this week",
    subreddit: "r/forhire",
    budget: "$40/hr",
    age: "11m",
    score: 81,
    reason: "React performance is in your portfolio",
  },
  {
    id: "framer",
    title: "Landing page in Framer for a fintech launch",
    subreddit: "r/DesignJobs",
    budget: "$300",
    age: "18m",
    score: 62,
    reason: "Framer isn't one of your skills",
  },
  {
    id: "wordpress",
    title: "Fix the contact form on our WordPress site",
    subreddit: "r/freelance_forhire",
    budget: "$80",
    age: "21m",
    score: 55,
    reason: "Small job; WordPress is a side skill",
  },
  {
    id: "mvp",
    title: "Build our MVP app, equity only for now",
    subreddit: "r/forhire",
    budget: "None",
    age: "25m",
    score: 31,
    reason: "No pay offered",
    flag: "Unpaid",
  },
  {
    id: "video",
    title: "Video editor for weekly YouTube shorts",
    subreddit: "r/VideoEditingRequests",
    budget: "$25/video",
    age: "32m",
    score: 12,
    reason: "Video editing isn't in your profile",
  },
];

const draft =
  "Hi! You want the course landing page rebuilt in Next.js. I shipped two edtech sites on the same stack this year: priya.dev/edtech. I can send a plan and a timeline today. When do you need it live?";

// Timeline (ms after the demo scrolls into view).
const FIRST_SCORE_AT = 900;
const SCORE_EVERY = 420;
const DRAFT_AT = FIRST_SCORE_AT + posts.length * SCORE_EVERY + 500;
const TYPE_DURATION = 2.6; // seconds

const ease: Transition["ease"] = [0.2, 0, 0, 1];

function scoreTone(post: DemoPost) {
  if (post.score >= 90) return "bg-flare-600 text-white";
  if (post.score >= 80) return "bg-flare-50 text-flare-700";
  return "bg-muted text-muted-foreground";
}

function ScoreCell({ post, scored }: { post: DemoPost; scored: boolean }) {
  if (!scored) {
    return (
      <span className="inline-flex h-6 items-center text-[13px] text-muted-foreground/80">
        <span className="text-shimmer">Scoring…</span>
      </span>
    );
  }
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease }}
      className={cn(
        "inline-flex h-6 min-w-9 items-center justify-center rounded-md px-1.5 text-[13px] font-semibold tabular-nums",
        scoreTone(post),
      )}
    >
      {post.score}
    </motion.span>
  );
}

function ReasonCell({ post, scored }: { post: DemoPost; scored: boolean }) {
  if (!scored) return <span className="text-muted-foreground/50">—</span>;
  return (
    <motion.span
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease }}
      className="flex min-w-0 items-center gap-2"
    >
      {post.flag && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-danger-soft px-1.5 py-0.5 text-xs font-medium text-danger">
          <FlagIcon className="size-3" />
          {post.flag}
        </span>
      )}
      <span className="truncate text-muted-foreground">{post.reason}</span>
    </motion.span>
  );
}

function Sidebar() {
  const items = [
    { label: "Matches", icon: InboxIcon, count: "12", active: true },
    { label: "Drafts", icon: PenLineIcon, count: "3" },
    { label: "Tracker", icon: KanbanSquareIcon },
    { label: "Profile", icon: UserRoundIcon },
  ];
  return (
    <div className="hidden w-52 shrink-0 flex-col gap-5 border-r border-border bg-cream/60 p-3 md:flex">
      <div className="flex items-center gap-2 px-1.5 pt-1">
        <span className="grid size-6 place-items-center rounded-md bg-ink text-xs font-semibold text-bone">
          P
        </span>
        <span className="text-sm font-semibold">Priya&apos;s gigs</span>
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-0.5">
        {items.map(({ label, icon: Icon, count, active }) => (
          <div
            key={label}
            className={cn(
              "flex h-8 items-center gap-2 rounded-md px-2 text-[13px]",
              active
                ? "bg-background font-medium shadow-xs"
                : "text-foreground/75",
            )}
          >
            <Icon className="size-4 text-muted-foreground" />
            {label}
            {count && (
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {count}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="px-2 pb-1 text-xs text-muted-foreground">Watching</p>
        {["r/forhire", "r/hiring", "r/DesignJobs", "r/freelance_forhire"].map(
          (sub) => (
            <div
              key={sub}
              className="flex h-7 items-center px-2 text-[13px] text-foreground/75"
            >
              {sub}
            </div>
          ),
        )}
      </div>
      <div className="mt-auto flex items-center gap-2 rounded-md border border-border bg-background px-2 py-2 text-xs text-muted-foreground">
        <SendIcon className="size-3.5" />
        Alerts go to Telegram
      </div>
    </div>
  );
}

function DraftPanel({ typed, done }: { typed: number; done: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-[0_24px_48px_-24px_rgb(26_21_18/0.35)]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Comment draft</span>
        <span className="rounded-md bg-flare-600 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums">
          94
        </span>
      </div>
      <p className="text-sm leading-snug font-semibold">
        Next.js developer to rebuild our course landing page
      </p>
      <div className="min-h-[7.5rem] rounded-lg border border-border bg-cream/50 p-3 text-[13px] leading-relaxed">
        {draft.slice(0, typed)}
        {!done && (
          <span className="ml-px inline-block h-[1.05em] w-px translate-y-[0.15em] animate-pulse bg-foreground" />
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground">
          Copy reply
        </span>
        <span className="inline-flex h-8 items-center gap-1 rounded-lg border border-input px-3 text-[13px] font-medium">
          Open post
          <ArrowUpRightIcon className="size-3.5" />
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          You send it
        </span>
      </div>
    </div>
  );
}

export function HeroDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const reduceMotion = useReducedMotion();

  const [scoredCount, setScoredCount] = useState(0);
  const [showDraft, setShowDraft] = useState(false);
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    if (!inView || reduceMotion) return;
    const timers = posts.map((_, i) =>
      setTimeout(() => setScoredCount(i + 1), FIRST_SCORE_AT + i * SCORE_EVERY),
    );
    let typing: ReturnType<typeof animate> | undefined;
    timers.push(
      setTimeout(() => {
        setShowDraft(true);
        typing = animate(0, draft.length, {
          duration: TYPE_DURATION,
          ease: "linear",
          delay: 0.35,
          onUpdate: (v) => setTyped(Math.round(v)),
        });
      }, DRAFT_AT),
    );
    return () => {
      timers.forEach(clearTimeout);
      typing?.stop();
    };
  }, [inView, reduceMotion]);

  // With reduced motion, skip the sequence and show the finished state.
  const scored = reduceMotion ? posts.length : scoredCount;
  const draftVisible = reduceMotion || showDraft;
  const typedChars = reduceMotion ? draft.length : typed;
  const typingDone = typedChars >= draft.length;
  const topSelected = draftVisible;

  const rowMotion = (i: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 6 },
          animate: inView ? { opacity: 1, y: 0 } : undefined,
          transition: { duration: 0.45, ease, delay: 0.15 + i * 0.07 },
        };

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="relative overflow-hidden rounded-2xl border border-border bg-cream/70 p-1.5 shadow-[0_50px_100px_-50px_rgb(26_21_18/0.45)]"
    >
      <div className="flex h-7 items-center gap-1.5 px-2">
        <span className="size-2.5 rounded-full bg-feed" />
        <span className="size-2.5 rounded-full bg-feed" />
        <span className="size-2.5 rounded-full bg-feed" />
      </div>
      <div className="relative flex h-[30rem] overflow-hidden rounded-xl border border-border bg-background text-left md:h-[32rem]">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">Matches</span>
            <span className="text-xs text-muted-foreground">12 new today</span>
            <div className="ml-auto hidden items-center gap-1.5 sm:flex">
              {["Web development", "Score 80+", "Paid only"].map((f) => (
                <span
                  key={f}
                  className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs text-foreground/80"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* Desktop: table */}
          <div className="hidden text-[13px] md:block">
            <div className="grid grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_4.5rem] gap-4 border-b border-border px-4 py-2 text-xs text-muted-foreground lg:grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_4.5rem_15rem]">
              <span>Post</span>
              <span>Subreddit</span>
              <span>Posted budget</span>
              <span>Match</span>
              <span className="hidden lg:block">Why</span>
            </div>
            {posts.map((post, i) => (
              <motion.div
                key={post.id}
                {...rowMotion(i)}
                className={cn(
                  "grid h-12 grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_4.5rem] items-center gap-4 border-b border-border px-4 transition-colors duration-500 lg:grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_4.5rem_15rem]",
                  i === 0 &&
                    topSelected &&
                    "bg-flare-50/70 shadow-[inset_2px_0_0_var(--color-flare-500)]",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{post.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {post.age}
                  </span>
                </span>
                <span className="truncate text-foreground/75">
                  {post.subreddit}
                </span>
                <span className="text-foreground/75 tabular-nums">
                  {post.budget}
                </span>
                <ScoreCell post={post} scored={i < scored} />
                <span className="hidden min-w-0 lg:block">
                  <ReasonCell post={post} scored={i < scored} />
                </span>
              </motion.div>
            ))}
          </div>

          {/* Phone: stacked list */}
          <div className="flex flex-col md:hidden">
            {posts.slice(0, 4).map((post, i) => (
              <motion.div
                key={post.id}
                {...rowMotion(i)}
                className={cn(
                  "flex items-center gap-3 border-b border-border px-4 py-3",
                  i === 0 &&
                    topSelected &&
                    "bg-flare-50/70 shadow-[inset_2px_0_0_var(--color-flare-500)]",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium">
                    {post.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {post.subreddit}, {post.budget}
                  </span>
                </div>
                <ScoreCell post={post} scored={i < scored} />
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div
          initial={false}
          animate={
            draftVisible
              ? { opacity: 1, y: 0, pointerEvents: "auto" }
              : { opacity: 0, y: 16, pointerEvents: "none" }
          }
          transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease }}
          className="absolute inset-x-3 bottom-3 md:inset-x-auto md:top-[8.5rem] md:right-4 md:bottom-auto md:w-[23rem]"
        >
          <DraftPanel typed={typedChars} done={typingDone} />
        </motion.div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-20 bg-linear-to-t from-background to-transparent md:block" />
      </div>
    </div>
  );
}
