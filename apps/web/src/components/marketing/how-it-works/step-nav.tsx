"use client";

import { useEffect, useRef, useState } from "react";
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

export function StepNav({ steps }: { steps: StepLink[] }) {
  const ids = steps.map((s) => s.id);
  const active = useActiveStep(ids);
  const stripRef = useRef<HTMLOListElement>(null);

  // Keep the active tab visible in the phone strip without scrolling the page.
  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>(`[data-step="${active}"]`);
    if (!strip || !tab) return;
    const left = tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2;
    strip.scrollTo({ left, behavior: "smooth" });
  }, [active]);

  return (
    <>
      {/* Phone and tablet: sticky tab strip */}
      <nav
        aria-label="How it works"
        className="sticky top-16 z-30 border-b border-border bg-cream/95 backdrop-blur-md lg:hidden"
      >
        <ol
          ref={stripRef}
          className="flex [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden"
        >
          {steps.map((step) => (
            <li key={step.id} data-step={step.id} className="shrink-0">
              <a
                href={`#${step.id}`}
                aria-current={active === step.id ? "step" : undefined}
                className={cn(
                  "flex h-12 items-center border-b-2 px-4 text-[15px] font-medium whitespace-nowrap transition-colors duration-300 ease-snappy focus-visible:bg-muted focus-visible:outline-none",
                  active === step.id
                    ? "border-flare-500 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {step.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* Desktop: sticky side list */}
      <nav
        aria-label="How it works"
        className="hidden border-r border-border lg:block"
      >
        <ol className="sticky top-16 flex flex-col gap-1 py-20">
          {steps.map((step) => (
            <li key={step.id} className="relative">
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-1/2 left-0 h-6 w-px -translate-y-1/2 bg-flare-500 transition-opacity duration-300",
                  active === step.id ? "opacity-100" : "opacity-0",
                )}
              />
              <a
                href={`#${step.id}`}
                aria-current={active === step.id ? "step" : undefined}
                className={cn(
                  "block px-12 py-1.5 text-lg tracking-[-0.01em] transition-colors duration-300 ease-snappy focus-visible:underline focus-visible:outline-none",
                  active === step.id
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {step.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
