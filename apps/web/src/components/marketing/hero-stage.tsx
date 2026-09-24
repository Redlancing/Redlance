"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { ArrowUpRightIcon } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

// Sample content, matching the demo in the main window.

function Window({
  title,
  dark,
  className,
  children,
}: {
  title: string;
  dark?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-1 shadow-[0_30px_60px_-30px_rgb(26_21_18/0.45)] backdrop-blur-md",
        dark ? "border-ink bg-ink" : "border-border bg-cream/80",
        className,
      )}
    >
      <div className="flex h-6 items-center gap-1.5 px-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              "size-2 rounded-full",
              dark ? "bg-bone/25" : "bg-feed",
            )}
          />
        ))}
        <span
          className={cn(
            "ml-2 truncate text-[11px]",
            dark ? "text-bone/50" : "text-muted-foreground",
          )}
        >
          {title}
        </span>
      </div>
      <div
        className={cn(
          "overflow-hidden rounded-xl",
          dark
            ? "bg-[#120e0b] text-bone"
            : "border border-border bg-background",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function TelegramWindow() {
  return (
    <Window title="Redlance bot on Telegram">
      <div className="flex flex-col gap-2 p-3 text-[12px] leading-snug">
        <div className="flex items-start gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-flare-500">
            <LogoMark className="size-3.5 [&_.fill-feed]:fill-white/55 [&_.fill-flare-500]:fill-white" />
          </span>
          <div className="rounded-lg rounded-tl-sm bg-secondary px-2.5 py-2">
            <p className="font-semibold">94 match on r/forhire</p>
            <p>Next.js developer to rebuild our course landing page</p>
            <p className="mt-1 text-muted-foreground">
              Posted budget $600, remote
            </p>
          </div>
        </div>
        <div className="ml-8 grid grid-cols-2 gap-1.5 font-medium">
          <span className="rounded-md bg-secondary py-1.5 text-center">
            Open draft
          </span>
          <span className="rounded-md bg-secondary py-1.5 text-center text-muted-foreground">
            Skip
          </span>
        </div>
        <span className="ml-auto rounded-lg rounded-tr-sm bg-ink px-2.5 py-1.5 text-bone">
          Open draft
        </span>
      </div>
    </Window>
  );
}

function TerminalWindow() {
  const dot = <span className="text-flare-500">●</span>;
  const branch = <span className="text-bone/30">└</span>;
  return (
    <Window title="redlance-worker" dark>
      <div className="flex flex-col gap-1 p-3 font-mono text-[11px] leading-relaxed">
        <p className="rounded-md bg-bone/5 px-2 py-1.5 text-bone/90">
          <span className="text-bone/40">$</span> watch 14 subreddits
        </p>
        <p className="mt-1">{dot} Polled r/forhire: 25 new, 3 hiring</p>
        <p className="pl-3 text-bone/60">
          {branch} Next.js developer to rebuild our course…
        </p>
        <p>{dot} Read the post</p>
        <p className="pl-3 text-bone/60">
          {branch} Next.js, Tailwind. $600 posted, paid, remote
        </p>
        <p>{dot} Match 94. Alert sent to Telegram</p>
        <p className="mt-1 text-bone/40">Next poll in 2 min</p>
      </div>
    </Window>
  );
}

function PostWindow() {
  return (
    <Window title="Original post">
      <div className="flex flex-col gap-2 p-3 text-[12px] leading-relaxed">
        <p className="text-muted-foreground">r/forhire, 2 min ago</p>
        <p className="font-semibold">
          [Hiring] Next.js developer to rebuild our course landing page
        </p>
        <p className="text-muted-foreground">
          We sell online design courses and our landing page is slow and hard to
          update. Budget is $600, fixed. Ideally live in two weeks.
        </p>
        <span className="inline-flex items-center gap-1 font-medium text-flare-700">
          Open post
          <ArrowUpRightIcon className="size-3.5" />
        </span>
      </div>
    </Window>
  );
}

function Floating({
  className,
  progress,
  from,
  children,
}: {
  className: string;
  progress: MotionValue<number>;
  from: { x: number; y: number };
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const x = useTransform(progress, [0, 1], [from.x, 0]);
  const y = useTransform(progress, [0, 1], [from.y, 0]);
  const scale = useTransform(progress, [0, 1], [0.92, 1]);
  const opacity = useTransform(progress, [0, 0.6], [0, 1]);
  return (
    <motion.div
      className={cn("absolute hidden min-[1360px]:block", className)}
      style={reduceMotion ? undefined : { x, y, scale, opacity }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Attio's hero composition: at first only the main window shows. As the page
 * scrolls, the demo settles slightly smaller and three more windows slide out
 * from behind it (Telegram, the worker terminal, the original post).
 */
export function HeroStage({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  const { scrollY } = useScroll();
  const smooth = useSpring(scrollY, { stiffness: 140, damping: 28 });
  const reveal = useTransform(smooth, [40, 320], [0, 1], { clamp: true });
  const demoScale = useTransform(smooth, [0, 700], [1, 0.95]);

  return (
    <div aria-hidden="true" className="relative">
      <Floating
        className="top-16 -right-36 z-0 w-64"
        progress={reveal}
        from={{ x: -120, y: 30 }}
      >
        <PostWindow />
      </Floating>

      <motion.div
        className="relative z-10"
        style={reduceMotion ? undefined : { scale: demoScale }}
      >
        {children}
      </motion.div>

      <Floating
        className="-top-8 -left-36 z-20 w-72"
        progress={reveal}
        from={{ x: 110, y: 50 }}
      >
        <TelegramWindow />
      </Floating>
      <Floating
        className="bottom-20 -left-28 z-20 w-80"
        progress={reveal}
        from={{ x: 100, y: -40 }}
      >
        <TerminalWindow />
      </Floating>
    </div>
  );
}
