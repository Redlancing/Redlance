"use client";

import { useEffect } from "react";

/**
 * Switches the sticky header to its dark theme while it sits over a section
 * marked `data-header-theme="dark"`. Adding the `dark` class re-scopes the
 * theme tokens, so the header's own classes need no dark variants.
 */
export function HeaderThemeSync({ headerId }: { headerId: string }) {
  useEffect(() => {
    const header = document.getElementById(headerId);
    if (!header) return;

    const overDark = new Set<Element>();
    let observer: IntersectionObserver | undefined;

    const observe = () => {
      observer?.disconnect();
      overDark.clear();
      // Watch a thin band through the middle of the header.
      const band = Math.round(header.offsetHeight / 2);
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) overDark.add(entry.target);
            else overDark.delete(entry.target);
          }
          header.classList.toggle("dark", overDark.size > 0);
        },
        {
          rootMargin: `-${band}px 0px -${window.innerHeight - band - 1}px 0px`,
        },
      );
      document
        .querySelectorAll('[data-header-theme="dark"]')
        .forEach((el) => observer!.observe(el));
    };

    observe();
    window.addEventListener("resize", observe);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", observe);
      header.classList.remove("dark");
    };
  }, [headerId]);

  return null;
}
