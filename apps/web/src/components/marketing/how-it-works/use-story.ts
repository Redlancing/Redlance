"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";

/**
 * Plays a short scripted sequence once, when the element scrolls into view.
 * Returns the current beat (0 … beats - 1). With reduced motion it jumps
 * straight to the last beat.
 */
export function useStory(
  beats: number,
  {
    every = 900,
    startAfter = 500,
  }: { every?: number; startAfter?: number } = {},
) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.45 });
  const reduceMotion = useReducedMotion();
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (!inView || reduceMotion) return;
    const timers = Array.from({ length: beats - 1 }, (_, i) =>
      setTimeout(() => setBeat(i + 1), startAfter + i * every),
    );
    return () => timers.forEach(clearTimeout);
  }, [inView, reduceMotion, beats, every, startAfter]);

  return {
    ref,
    beat: reduceMotion ? beats - 1 : beat,
    reduceMotion: Boolean(reduceMotion),
  };
}
