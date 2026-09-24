"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  type Transition,
} from "motion/react";
import { ArrowRightIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FunnelScene, OrbitScene, RadarScene } from "./alerts-scenes";
import { Frame, SectionChip, TwoToneHeading } from "./primitives";

const ease: Transition["ease"] = [0.2, 0, 0, 1];
const SLIDE_MS = 5000;

const channels = [
  {
    id: "telegram",
    title: "Telegram alerts",
    body: "A message the moment a post clears your score bar, with the draft one tap away. Instant on Pro, within the hour on Free.",
    Scene: RadarScene,
  },
  {
    id: "feed",
    title: "Your match feed",
    body: "Hundreds of posts go in. Only the ones worth your time come out, with the full post and your drafts beside them.",
    Scene: FunnelScene,
  },
  {
    id: "digest",
    title: "Daily digest",
    soon: true,
    body: "One email with the day's best matches, for the days you're away from Telegram.",
    Scene: OrbitScene,
  },
] as const;

/**
 * Laid out and paced like Attio's Signals block: headline top-left, the list
 * pinned to the bottom, the active item opening to show its description and
 * a 5s progress bar, and a line-art scene on the right that changes with it.
 * Clicking an item jumps to it and restarts the timer. Beyond Attio, it
 * pauses on hover or keyboard focus and never autoplays with reduced motion.
 */
export function Alerts() {
  const baseId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const reduceMotion = Boolean(useReducedMotion());
  const [index, setIndex] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = !inView || hovered || focused;

  const select = (i: number) => {
    setIndex(i);
    setCycle((c) => c + 1);
  };
  const next = () => select((index + 1) % channels.length);

  return (
    <section
      id="alerts"
      aria-labelledby="alerts-heading"
      data-header-theme="dark"
      className="dark border-b border-border bg-background text-foreground"
    >
      <Frame>
        <div ref={ref} className="grid lg:grid-cols-2">
          <div className="border-border px-4 py-20 sm:px-12 sm:py-24 lg:border-r lg:px-16 lg:py-28">
            <div className="flex flex-col lg:h-[35rem]">
              <div className="flex flex-col items-start gap-8">
                <div className="flex flex-col items-start gap-6">
                  <SectionChip>Alerts</SectionChip>
                  <TwoToneHeading
                    id="alerts-heading"
                    lead="Every good match, none of the noise."
                    rest="Ready to reply first."
                    className="max-w-[30rem]"
                  />
                </div>
                <Link
                  href="/#pricing"
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                    className: "h-8 rounded-[10px] px-2.5 text-xs",
                  })}
                >
                  See plans
                  <ArrowRightIcon aria-hidden="true" className="size-3.5" />
                </Link>
              </div>

              <div className="min-h-16 flex-1" />

              <ul
                className="flex w-full flex-col gap-7"
                onPointerEnter={() => setHovered(true)}
                onPointerLeave={() => setHovered(false)}
                // Pause for keyboard focus only; a mouse click should restart
                // the timer and keep playing, as on Attio.
                onFocus={(e) => {
                  if (e.target.matches(":focus-visible")) setFocused(true);
                }}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget))
                    setFocused(false);
                }}
              >
                {channels.map((channel, i) => {
                  const active = i === index;
                  const panelId = `${baseId}-${channel.id}`;
                  return (
                    <li key={channel.id} className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => select(i)}
                        aria-expanded={active}
                        aria-controls={panelId}
                        className={cn(
                          "flex w-fit items-center gap-2 text-left text-lg leading-[1.4] font-medium tracking-[-0.01em] text-foreground decoration-foreground/40 underline-offset-4 focus-visible:underline focus-visible:outline-none",
                          !active && "hover:underline",
                        )}
                      >
                        {channel.title}
                        {"soon" in channel && (
                          <span className="rounded-md bg-flare-500/15 px-1.5 py-px text-xs font-medium text-flare-400">
                            Soon
                          </span>
                        )}
                      </button>
                      <AnimatePresence initial={false}>
                        {active && (
                          <motion.div
                            id={panelId}
                            key="panel"
                            initial={{
                              height: 0,
                              opacity: 0,
                              filter: "blur(4px)",
                            }}
                            animate={{
                              height: "auto",
                              opacity: 1,
                              filter: "blur(0px)",
                            }}
                            exit={{
                              height: 0,
                              opacity: 0,
                              filter: "blur(4px)",
                            }}
                            transition={{
                              duration: reduceMotion ? 0 : 0.45,
                              ease,
                            }}
                            className="overflow-hidden"
                          >
                            <p className="mt-2 max-w-[22.5rem] leading-[1.4] font-medium text-balance text-muted-foreground">
                              {channel.body}
                            </p>
                            <div className="mt-5 h-0.5 w-full overflow-hidden bg-border">
                              {!reduceMotion && (
                                <span
                                  key={cycle}
                                  onAnimationEnd={next}
                                  className="block size-full origin-left bg-muted-foreground"
                                  style={{
                                    animation: `grow-x ${SLIDE_MS}ms linear forwards`,
                                    animationPlayState: paused
                                      ? "paused"
                                      : "running",
                                  }}
                                />
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="relative aspect-[6/7] overflow-hidden border-t border-border lg:aspect-auto lg:border-t-0"
          >
            <AnimatePresence initial={false}>
              {channels.map(({ id, Scene }, i) =>
                i === index ? (
                  <motion.div
                    key={id}
                    initial={{ opacity: 0, scale: 0.96, filter: "blur(6px)" }}
                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, scale: 1.03, filter: "blur(6px)" }}
                    transition={{ duration: reduceMotion ? 0 : 0.7, ease }}
                    className="absolute inset-0 p-6"
                  >
                    <Scene playing={inView} animate={!reduceMotion} />
                  </motion.div>
                ) : null,
              )}
            </AnimatePresence>
          </div>
        </div>
      </Frame>
    </section>
  );
}
