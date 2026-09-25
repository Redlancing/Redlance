"use client";

import { useId, useRef, useState } from "react";
import { useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { cn } from "@/lib/utils";
import { Frame } from "./primitives";

// Our own promise, not a customer quote: there are no customers to quote yet.
const QUOTE =
  "Every hour you spend hunting for gigs is an hour nobody pays you for. Redlance gives those hours back.";
const WORDS = QUOTE.split(" ");

// Share of the section's scroll over which the words light up, measured on
// Attio: from just after the dark block starts lifting until shortly after
// it has gone.
const START = 0.1;
const END = 0.78;

/**
 * Attio's curtain quote. The section is pulled up under the dark block
 * (`-mt-[100svh]`, below its z-10), so the quote is already pinned when the
 * dark block scrolls away. It then stays pinned while each word turns from
 * grey to ink with the scroll.
 */
export function PromiseQuote() {
  const patternId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });
  const [lit, setLit] = useState(0);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const next = Math.round(
      Math.min(Math.max((p - START) / (END - START), 0), 1) * WORDS.length,
    );
    setLit((current) => (current === next ? current : next));
  });

  const shown = reduceMotion ? WORDS.length : lit;

  return (
    <section
      aria-label="Our promise"
      className="relative z-0 -mt-[100svh] bg-background"
    >
      <Frame>
        <div ref={ref} className="h-[250svh]">
          <div className="sticky top-16 flex h-[calc(100svh-4rem)] flex-col justify-center overflow-hidden">
            <svg
              aria-hidden="true"
              className="absolute inset-0 size-full text-border"
            >
              <defs>
                <pattern
                  id={patternId}
                  width="10"
                  height="10"
                  patternUnits="userSpaceOnUse"
                >
                  <rect
                    x="5.5"
                    y="5.5"
                    width="1"
                    height="1"
                    fill="currentColor"
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#${patternId})`} />
            </svg>

            <div aria-hidden="true" className="h-25 lg:h-30 xl:h-40" />
            <figure className="relative flex flex-1 flex-col items-center justify-center px-6">
              <p className="max-w-[18em] text-center font-serif text-[1.875rem] leading-9 tracking-[-0.015em] text-balance lg:text-[3rem] lg:leading-[3.25rem]">
                <span className="sr-only">{QUOTE}</span>
                <span aria-hidden="true">
                  {WORDS.map((word, i) => (
                    <span
                      key={i}
                      className={cn(
                        "transition-colors duration-500 ease-out",
                        i < shown ? "text-foreground" : "text-foreground/30",
                      )}
                    >
                      {word}{" "}
                    </span>
                  ))}
                </span>
              </p>
              <figcaption className="mt-9 text-center text-sm lg:mt-13">
                <span className="block font-semibold">
                  The Redlance promise
                </span>
                <span className="mt-0.5 block font-medium text-muted-foreground">
                  See the right gigs first. Reply in under two minutes.
                </span>
              </figcaption>
            </figure>
            <div aria-hidden="true" className="h-25 lg:h-30 xl:h-40" />
          </div>
        </div>
      </Frame>
    </section>
  );
}
