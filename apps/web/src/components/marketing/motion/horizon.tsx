"use client";

import { useRef } from "react";
import {
  motion,
  useMotionTemplate,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

/**
 * The glowing horizon for dark showcases. As the section scrolls up, the rim
 * is swept in from left to right (a feathered mask tied to scroll, spring-smoothed),
 * the way Attio's Universal Context arc behaves. A dark body circle sits on
 * top so only the rim's edge shows.
 */
export function Horizon({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  // 0 when the block's top meets the bottom of the viewport, 1 at the top.
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "start start"],
  });
  const progress = useSpring(scrollYProgress, {
    stiffness: 70,
    damping: 22,
    mass: 0.6,
  });
  // A feathered mask sweeps left to right, so the light seems to travel along
  // the rim. It overshoots past 100% so the right edge ends fully lit.
  const edge = useTransform(progress, [0.3, 0.95], [0, 118]);
  const maskImage = useMotionTemplate`linear-gradient(90deg, #000 calc(${edge}% - 18%), transparent ${edge}%)`;
  const opacity = useTransform(progress, [0.25, 0.8], [0, 1]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={className ?? "pointer-events-none absolute inset-0 -z-10"}
    >
      <motion.div
        className="absolute inset-0"
        style={
          reduceMotion
            ? undefined
            : { maskImage, WebkitMaskImage: maskImage, opacity }
        }
      >
        <div className="absolute inset-0 animate-hue-drift">
          {/* Soft glow */}
          <div className="absolute top-[15rem] left-1/2 aspect-square w-[200%] -translate-x-1/2 rounded-full bg-[linear-gradient(90deg,transparent_12%,#ff5a1f_32%,#ffb48a_50%,#ff5a1f_68%,transparent_88%)] opacity-60 blur-[14px] sm:top-[19rem] sm:w-[140%]" />
          {/* Sharp rim */}
          <div className="absolute top-[15rem] left-1/2 aspect-square w-[200%] -translate-x-1/2 rounded-full bg-[linear-gradient(90deg,transparent_16%,#ff5a1f_34%,#ffd9c4_50%,#ff5a1f_66%,transparent_84%)] blur-[1px] sm:top-[19rem] sm:w-[140%]" />
        </div>
      </motion.div>
      {/* Planet body */}
      <div className="absolute top-[calc(15rem+2px)] left-1/2 aspect-square w-[200%] -translate-x-1/2 rounded-full bg-background sm:top-[calc(19rem+2px)] sm:w-[140%]" />
    </div>
  );
}
