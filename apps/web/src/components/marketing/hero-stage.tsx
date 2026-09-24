"use client";

import { useRef } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { CheckIcon, FlagIcon } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

// Sample content, as in the demo it surrounds.

function FloatingCard({
  className,
  origin,
  scale,
  opacity,
  bobDelay,
  children,
}: {
  className: string;
  origin: string;
  scale: MotionValue<number>;
  opacity: MotionValue<number>;
  bobDelay: string;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={cn("absolute z-10 hidden w-60 xl:block", className)}
      style={
        reduceMotion ? undefined : { scale, opacity, transformOrigin: origin }
      }
    >
      <div
        className="animate-bob rounded-xl border border-border bg-background p-3 text-[13px] shadow-[0_20px_40px_-20px_rgb(26_21_18/0.35)]"
        style={{ animationDelay: bobDelay }}
      >
        {children}
      </div>
    </motion.div>
  );
}

/**
 * Wraps the hero demo: scales it down slightly as it scrolls past and grows
 * three floating cards out from the corners nearest the demo (Attio's hero).
 */
export function HeroStage({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const demoScale = useTransform(scrollYProgress, [0.4, 0.8], [1, 0.96]);
  const cardScale = useTransform(scrollYProgress, [0.12, 0.42], [0.86, 1]);
  const cardOpacity = useTransform(scrollYProgress, [0.12, 0.32], [0, 1]);

  return (
    <div ref={ref} aria-hidden="true" className="relative">
      <motion.div style={reduceMotion ? undefined : { scale: demoScale }}>
        {children}
      </motion.div>

      <FloatingCard
        className="top-20 -left-20"
        origin="100% 100%"
        scale={cardScale}
        opacity={cardOpacity}
        bobDelay="0s"
      >
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-full bg-flare-500">
            <LogoMark className="size-4 [&_.fill-feed]:fill-white/55 [&_.fill-flare-500]:fill-white" />
          </span>
          <span className="font-medium">Redlance bot</span>
          <span className="ml-auto text-xs text-muted-foreground">now</span>
        </div>
        <p className="mt-2 font-semibold">94 match on r/forhire</p>
        <p className="text-muted-foreground">Next.js course landing page</p>
      </FloatingCard>

      <FloatingCard
        className="top-56 -right-16"
        origin="0% 50%"
        scale={cardScale}
        opacity={cardOpacity}
        bobDelay="-1.6s"
      >
        <span className="inline-flex items-center gap-1 rounded-md bg-danger-soft px-1.5 py-0.5 text-xs font-medium text-danger">
          <FlagIcon className="size-3" />
          Red flag: unpaid
        </span>
        <p className="mt-2 font-medium">Build our MVP app, equity only</p>
        <p className="text-muted-foreground">Hidden from your alerts</p>
      </FloatingCard>

      <FloatingCard
        className="bottom-28 -left-14"
        origin="100% 0%"
        scale={cardScale}
        opacity={cardOpacity}
        bobDelay="-3s"
      >
        <span className="inline-flex items-center gap-1 rounded-md bg-success-soft px-1.5 py-0.5 text-xs font-medium text-success">
          <CheckIcon className="size-3" />
          Marked as hired
        </span>
        <p className="mt-2 font-medium">Next.js course landing page</p>
        <p className="text-muted-foreground tabular-nums">
          $600, replied in 1:52
        </p>
      </FloatingCard>
    </div>
  );
}
