"use client";

import { useRef } from "react";
import { motion, useInView, type Transition } from "motion/react";
import { Streaks } from "./motion/streaks";
import { Frame, SectionChip, TwoToneHeading } from "./primitives";

// Product facts, not results: we don't quote outcomes until we have them.
const stats = [
  { value: "< 2 min", label: "from alert to sent reply" },
  { value: "2–3 min", label: "between feed checks" },
  { value: "24/7", label: "watching while you work" },
  { value: "0%", label: "taken from what you earn" },
];

// Attio's curve, y = 700·(1 − t^2.4) across a 1392×760 box, in 120 steps.
const W = 1392;
const H = 760;
const points = Array.from({ length: 121 }, (_, i) => {
  const t = i / 120;
  return `${(t * W).toFixed(1)} ${(700 * (1 - t ** 2.4)).toFixed(1)}`;
});
const CURVE = `M${points.join(" L ")}`;
// Everything above the curve, filled with the page colour, so the texture
// and wash only show beneath it.
const ABOVE = `M0 0 L${W} 0 L${[...points].reverse().join(" L ")} Z`;

const easeOut: Transition["ease"] = [0, 0, 0.58, 1];

/**
 * Laid out and timed like Attio's "Run at any scale" block: headline top
 * left, a 2×2 of stats with accent rails that blur in, and a rising curve
 * behind them that draws left to right while a fine line texture fills the
 * space beneath it.
 */
export function TimeBack() {
  const chartRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDListElement>(null);
  const chartIn = useInView(chartRef, {
    once: true,
    amount: 0.5,
    margin: "0px 0px -25% 0px",
  });
  const statsIn = useInView(statsRef, { once: true, amount: 0.6 });

  return (
    <section
      id="time-back"
      aria-labelledby="time-back-heading"
      className="relative overflow-clip bg-background"
    >
      <Frame className="relative flex flex-col overflow-clip pt-22 pb-10 md:pb-14 lg:min-h-[760px] lg:pt-28 xl:pt-38">
        <div
          ref={chartRef}
          aria-hidden="true"
          className="relative order-last mt-10 -mb-10 h-[220px] w-full overflow-clip md:-mb-14 md:h-[240px] lg:absolute lg:inset-0 lg:order-none lg:m-0 lg:h-auto"
        >
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={chartIn ? { opacity: 1 } : undefined}
            transition={{ duration: 1.1, delay: 0.1, ease: [0.45, 0, 0.55, 1] }}
          >
            <Streaks
              count={24}
              travel={H}
              grid="var(--color-border)"
              highlight="var(--color-foreground)"
              lineWidth={1}
              maxOpacity={0.55}
            />
          </motion.div>
          <motion.div
            className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(255_122_69/0.16),rgb(255_122_69/0)_85%)]"
            initial={{ opacity: 0 }}
            animate={chartIn ? { opacity: 1 } : undefined}
            transition={{ duration: 0.6, delay: 1.3, ease: easeOut }}
          />
          <svg
            className="absolute inset-0 size-full"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
          >
            <path d={ABOVE} fill="var(--color-background)" />
          </svg>
          <svg
            className="absolute inset-0 size-full text-stone/30"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
          >
            <Curve />
          </svg>
          <motion.svg
            className="absolute inset-0 size-full text-flare-500"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            initial={{ clipPath: "inset(0px 100% 0px 0px)" }}
            animate={
              chartIn ? { clipPath: "inset(0px 0% 0px 0px)" } : undefined
            }
            transition={{ duration: 1.2, delay: 0.1, ease: easeOut }}
          >
            <Curve />
          </motion.svg>
        </div>

        <div className="relative z-10 grid grid-cols-24">
          <div className="col-[3/-3] flex max-w-[29rem] flex-col items-start gap-6 lg:col-[2/-2]">
            <SectionChip>Time back</SectionChip>
            <TwoToneHeading
              id="time-back-heading"
              lead="Get your evenings back."
              rest="Spend them on work that pays."
              className="max-w-[22em]"
            />
          </div>
        </div>

        <div aria-hidden="true" className="hidden flex-[0.7] lg:block" />

        <div className="relative z-10 mt-10 grid grid-cols-24 lg:mt-0">
          <dl
            ref={statsRef}
            className="col-[3/-3] grid max-w-[30rem] grid-cols-2 gap-x-12 gap-y-8 lg:col-[2/-2]"
          >
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                className="flex flex-col-reverse gap-1.5 border-l-2 border-flare-500 pl-4 sm:pl-6"
                initial={{ opacity: 0, filter: "blur(1.5px)" }}
                animate={
                  statsIn ? { opacity: 1, filter: "blur(0px)" } : undefined
                }
                transition={{ duration: 0.5, delay: i * 0.08, ease: easeOut }}
              >
                <dt className="text-base leading-none font-medium tracking-[-0.01em] text-muted-foreground">
                  {stat.label}
                </dt>
                <dd className="text-[1.75rem] leading-none font-medium tracking-[-0.01em] tabular-nums sm:text-[2rem]">
                  {stat.value}
                </dd>
              </motion.div>
            ))}
          </dl>
        </div>

        <div aria-hidden="true" className="hidden flex-[2.2] lg:block" />
      </Frame>
    </section>
  );
}

function Curve() {
  return (
    <path
      d={CURVE}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}
