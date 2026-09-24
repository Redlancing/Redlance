"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

/**
 * The glow behind the hero windows, built like Attio's:
 * 1. a warm radial glow rising from the bottom,
 * 2. fine white vertical lines over it (the ribbed "lining"),
 * 3. a white dome at the top that shrinks as the page scrolls, letting more
 *    of the glow show (scaleX 1 → 0.57, scaleY 1 → 0.75 over ~700px).
 */
export function HeroBackdrop() {
  const reduceMotion = useReducedMotion();
  const { scrollY } = useScroll();
  const smooth = useSpring(scrollY, { stiffness: 120, damping: 30 });
  const scaleX = useTransform(smooth, [0, 400, 700], [1, 0.6, 0.57]);
  const scaleY = useTransform(smooth, [0, 400, 700], [1, 0.77, 0.75]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-[24rem] bottom-0 -z-10 overflow-clip sm:top-[28rem]"
    >
      <div className="absolute inset-0 bg-[radial-gradient(90%_80%_at_50%_100%,#fff4ec_0%,#ffd0b0_45%,#ff9b66_100%)] opacity-70" />
      <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,rgb(255_255_255/0.8)_0_1px,transparent_1px_8px)] opacity-45" />
      <motion.div
        className="absolute top-0 left-[-150%] h-[150%] w-[400%] origin-top bg-[radial-gradient(70%_106%_at_50%_0%,var(--color-background)_32%,transparent_64%)]"
        style={reduceMotion ? undefined : { scaleX, scaleY }}
      />
    </div>
  );
}
