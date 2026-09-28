"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ArrowRightIcon, XIcon } from "lucide-react";

const storageKey = (id: string) => `redlance:announcement:${id}`;

function readDismissed(id: string) {
  try {
    return localStorage.getItem(storageKey(id)) === "dismissed";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function AnnouncementBar({
  id,
  text,
  href,
}: {
  id: string;
  text: string;
  href: string;
}) {
  const storedDismissed = useSyncExternalStore(
    subscribe,
    () => readDismissed(id),
    () => false,
  );
  const [closed, setClosed] = useState(false);

  if (closed || storedDismissed) return null;

  function dismiss() {
    setClosed(true);
    try {
      localStorage.setItem(storageKey(id), "dismissed");
    } catch {
      // Storage can be unavailable (private mode); closing for this visit is enough.
    }
  }

  return (
    <div className="relative bg-ink text-bone">
      <div className="mx-auto flex min-h-10 max-w-[1440px] items-center justify-center px-12 py-2 text-center">
        <Link
          href={href}
          className="group text-[13px] leading-snug font-medium text-balance outline-none focus-visible:underline sm:text-sm"
        >
          {text}
          <ArrowRightIcon
            aria-hidden="true"
            className="ml-1.5 inline size-3.5 align-[-0.15em] transition-transform duration-300 ease-snappy group-hover:translate-x-0.5"
          />
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute top-1/2 right-3 grid size-8 -translate-y-1/2 place-items-center rounded-md text-bone/70 transition-colors hover:bg-bone/10 hover:text-bone focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:outline-none"
      >
        <XIcon aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
