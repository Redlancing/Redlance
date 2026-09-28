"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export type StepLink = { id: string; label: string };

/** Highlights the step whose section crosses the middle of the viewport. */
function useActiveStep(ids: string[]) {
  const [active, setActive] = useState(ids[0]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

/**
 * Scrolls to a step the way Attio does: a long ease-out (~1.1s), landing the
 * step flush under the sticky bars, without adding a #hash to the URL. Any
 * wheel, touch or key input from the user cancels it.
 */
function useStepScroll() {
  const reduceMotion = useReducedMotion();
  const running = useRef<ReturnType<typeof animate> | null>(null);

  return (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    const offset = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const to = Math.max(
      0,
      target.getBoundingClientRect().top + window.scrollY - offset,
    );
    const done = () => target.focus({ preventScroll: true });

    running.current?.stop();
    if (reduceMotion) {
      window.scrollTo({ top: to, behavior: "instant" });
      done();
      return;
    }

    const stop = () => running.current?.stop();
    const events = ["wheel", "touchstart", "keydown"] as const;
    events.forEach((e) =>
      window.addEventListener(e, stop, { once: true, passive: true }),
    );
    running.current = animate(window.scrollY, to, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => window.scrollTo({ top: v, behavior: "instant" }),
      onComplete: () => {
        events.forEach((e) => window.removeEventListener(e, stop));
        done();
      },
    });
  };
}

export function StepNav({ steps }: { steps: StepLink[] }) {
  const ids = steps.map((s) => s.id);
  const active = useActiveStep(ids);
  const scrollToStep = useStepScroll();
  const stripRef = useRef<HTMLDivElement>(null);

  // Keep the active tab visible in the phone strip without scrolling the page.
  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>(`[data-step="${active}"]`);
    if (!strip || !tab) return;
    const left = tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2;
    strip.scrollTo({ left, behavior: "smooth" });
  }, [active]);

  const onClick = (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let modified clicks (new tab etc.) behave like normal links.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
      return;
    e.preventDefault();
    scrollToStep(id);
  };

  return (
    <>
      {/* Phone and tablet: sticky strip of cells, the active one shaded */}
      <nav
        aria-label="How it works"
        className="sticky top-16 z-30 border-b border-border bg-cream shadow-[0_8px_16px_-12px_rgb(26_21_18/0.25)] lg:hidden"
      >
        <div
          ref={stripRef}
          className="[scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden"
        >
          <ol className="flex w-max min-w-full gap-px bg-border">
            {steps.map((step) => (
              <li key={step.id} data-step={step.id} className="flex-1">
                <a
                  href={`#${step.id}`}
                  onClick={onClick(step.id)}
                  aria-current={active === step.id ? "location" : undefined}
                  className={cn(
                    "flex h-12 items-center justify-center px-5 text-[15px] font-medium whitespace-nowrap transition-colors duration-200 ease-out focus-visible:underline focus-visible:outline-none",
                    active === step.id
                      ? "bg-secondary text-foreground"
                      : "bg-cream text-muted-foreground hover:bg-background hover:text-foreground",
                  )}
                >
                  {step.label}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>

      {/* Desktop: sticky side list with one sliding indicator */}
      <nav
        aria-label="How it works"
        className="hidden border-r border-border lg:block"
      >
        <ol className="sticky top-16 flex flex-col gap-2 py-20">
          {steps.map((step) => {
            const isActive = active === step.id;
            return (
              <li key={step.id} className="relative">
                {isActive && (
                  <motion.span
                    layoutId="step-indicator"
                    aria-hidden="true"
                    transition={{ type: "spring", stiffness: 420, damping: 38 }}
                    className="absolute inset-y-0 -left-px w-0.5 bg-flare-500"
                  />
                )}
                <a
                  href={`#${step.id}`}
                  onClick={onClick(step.id)}
                  aria-current={isActive ? "location" : undefined}
                  className={cn(
                    "block px-12 py-1 text-lg leading-[1.2] font-medium tracking-[-0.01em] transition-colors duration-[320ms] ease-[cubic-bezier(0.33,1,0.68,1)] focus-visible:underline focus-visible:outline-none motion-reduce:transition-none",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/80",
                  )}
                >
                  {step.label}
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
