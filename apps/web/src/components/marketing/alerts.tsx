"use client";

import { useId, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  type Transition,
} from "motion/react";
import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { Frame, SectionChip, TwoToneHeading } from "./primitives";

const ease: Transition["ease"] = [0.2, 0, 0, 1];
const SLIDE_SECONDS = 6;

const channels = [
  {
    id: "telegram",
    title: "Telegram",
    body: "A message with the score, the posted budget and a draft ready to open. Instant on Pro, within the hour on Free.",
  },
  {
    id: "feed",
    title: "Your match feed",
    body: "Every match in one place, with filters, the full post and your drafts.",
  },
  {
    id: "email",
    title: "Email digest",
    body: "A daily summary for the days you're away from Telegram.",
    soon: true,
  },
] as const;

type ChannelId = (typeof channels)[number]["id"];

/* Sample content for the visuals only. */
function TelegramVisual() {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-3 shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border px-1 pb-3">
        <span className="grid size-8 place-items-center rounded-full bg-flare-500">
          <LogoMark className="size-5 [&_.fill-feed]:fill-white/55 [&_.fill-flare-500]:fill-white" />
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-medium">Redlance bot</span>
          <span className="text-xs text-muted-foreground">just now</span>
        </div>
      </div>
      <div className="mt-3 rounded-xl bg-secondary p-3 text-[13px] leading-relaxed">
        <p className="font-semibold">94 match on r/forhire</p>
        <p className="mt-1">
          Next.js developer to rebuild our course landing page
        </p>
        <p className="mt-2 text-muted-foreground">
          Posted budget $600, remote. Next.js and Tailwind are your main stack.
        </p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[13px] font-medium">
        <span className="rounded-lg bg-secondary py-2 text-center">
          Open draft
        </span>
        <span className="rounded-lg bg-secondary py-2 text-center text-muted-foreground">
          Skip
        </span>
      </div>
    </div>
  );
}

function FeedVisual() {
  const rows = [
    ["Next.js developer to rebuild our course landing page", "94", true],
    ["Speed up our Shopify checkout before the Diwali sale", "88", false],
    ["React dashboard is slow, need someone this week", "81", false],
  ] as const;
  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-card text-[13px] shadow-2xl">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold">
        Matches
      </div>
      {rows.map(([title, score, top]) => (
        <div
          key={title}
          className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
        >
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums",
              top ? "bg-flare-600 text-white" : "bg-secondary text-flare-400",
            )}
          >
            {score}
          </span>
        </div>
      ))}
    </div>
  );
}

function EmailVisual() {
  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 text-[13px] shadow-2xl">
      <p className="text-xs text-muted-foreground">From Redlance</p>
      <p className="mt-1 text-sm font-semibold">Your 6 best matches today</p>
      <ul className="mt-3 flex flex-col gap-2 text-muted-foreground">
        <li>94: Next.js course landing page, $600</li>
        <li>88: Shopify checkout speed fix, ₹25,000</li>
        <li>81: React dashboard performance, $40/hr</li>
      </ul>
    </div>
  );
}

const visuals: Record<ChannelId, () => React.ReactNode> = {
  telegram: TelegramVisual,
  feed: FeedVisual,
  email: EmailVisual,
};

export function Alerts() {
  const baseId = useId();
  const sectionRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { amount: 0.4 });
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<ChannelId>("telegram");
  // Hover pauses autoplay; a click or keyboard focus stops it for good,
  // so people can read at their own pace.
  const [userControlled, setUserControlled] = useState(false);
  const [hovered, setHovered] = useState(false);
  const playing = inView && !reduceMotion && !userControlled && !hovered;

  const next = () => {
    const i = channels.findIndex((c) => c.id === active);
    setActive(channels[(i + 1) % channels.length].id);
  };

  const Visual = visuals[active];

  return (
    <section
      id="alerts"
      aria-labelledby="alerts-heading"
      data-header-theme="dark"
      className="dark border-b border-border bg-background text-foreground"
    >
      <Frame>
        <div
          ref={sectionRef}
          className="grid lg:grid-cols-2"
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocusCapture={() => setUserControlled(true)}
        >
          <div className="flex flex-col items-start gap-5 border-border px-4 py-20 sm:px-12 sm:py-24 lg:border-r lg:px-16">
            <SectionChip>Alerts</SectionChip>
            <TwoToneHeading
              id="alerts-heading"
              lead="Good matches find you."
              rest="A message arrives the moment a post clears your score bar, with a draft already waiting."
              className="max-w-[32rem]"
            />
            <ul className="mt-6 flex w-full max-w-[30rem] flex-col">
              {channels.map((channel) => {
                const isActive = channel.id === active;
                const panelId = `${baseId}-${channel.id}`;
                return (
                  <li key={channel.id} className="border-b border-border">
                    <button
                      type="button"
                      aria-expanded={isActive}
                      aria-controls={panelId}
                      onClick={() => {
                        setUserControlled(true);
                        setActive(channel.id);
                      }}
                      className="flex w-full items-center gap-2 py-4 text-left text-lg font-medium tracking-[-0.01em] focus-visible:underline focus-visible:outline-none"
                    >
                      <span
                        className={cn(
                          "transition-colors duration-300",
                          !isActive && "text-muted-foreground",
                        )}
                      >
                        {channel.title}
                      </span>
                      {"soon" in channel && (
                        <span className="rounded-md bg-flare-500/15 px-1.5 py-px text-xs font-medium text-flare-400">
                          Soon
                        </span>
                      )}
                    </button>
                    <div
                      id={panelId}
                      hidden={!isActive}
                      className="pb-5 leading-relaxed text-muted-foreground"
                    >
                      {channel.body}
                    </div>
                    <div className="relative -mb-px h-px overflow-hidden">
                      {isActive && playing && (
                        <motion.span
                          key={active}
                          className="absolute inset-0 origin-left bg-foreground"
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{
                            duration: SLIDE_SECONDS,
                            ease: "linear",
                          }}
                          onAnimationComplete={next}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div
            aria-hidden="true"
            className="relative flex min-h-[26rem] items-center justify-center overflow-hidden border-t border-border bg-[radial-gradient(rgb(247_242_236/0.09)_1px,transparent_1px)] [background-size:16px_16px] px-4 py-16 lg:border-t-0"
          >
            {/* Radar rings pulsing out from behind the visual */}
            <div className="pointer-events-none absolute top-1/2 left-1/2 size-[34rem] -translate-1/2">
              <div className="absolute inset-0 rounded-full border border-border" />
              <div className="absolute inset-[18%] rounded-full border border-border" />
              {[0, 1.2, 2.4].map((delay) => (
                <div
                  key={delay}
                  className="absolute inset-[10%] animate-radar rounded-full border border-flare-400/30"
                  style={{ animationDelay: `${delay}s` }}
                />
              ))}
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: reduceMotion ? 0 : 0.4, ease }}
                className="flex w-full justify-center"
              >
                <Visual />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </Frame>
    </section>
  );
}
