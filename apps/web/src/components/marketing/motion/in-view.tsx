"use client";

import { useRef } from "react";
import { useInView } from "motion/react";

/**
 * Marks its subtree with data-inview so CSS animations inside stay paused
 * until it scrolls into view (see the data-inview rule in globals.css).
 */
export function InView({
  className,
  children,
  amount = 0.35,
}: {
  className?: string;
  children: React.ReactNode;
  amount?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount });
  return (
    <div ref={ref} data-inview={inView} className={className}>
      {children}
    </div>
  );
}
