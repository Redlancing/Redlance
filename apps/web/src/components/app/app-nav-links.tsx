"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { appNav, isActiveHref } from "./app-nav";

/** The sidebar's list; client-side so the active item follows the URL. */
export function AppNavLinks() {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5">
      {appNav.map(({ title, href, icon: Icon, soon }) => {
        const active = isActiveHref(pathname, href);
        const content = (
          <>
            <Icon className="size-4" aria-hidden="true" />
            <span className="flex-1">{title}</span>
            {soon && (
              <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                Soon
              </span>
            )}
          </>
        );
        const base = "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm";
        return (
          <li key={href}>
            {soon ? (
              <span
                aria-disabled="true"
                className={cn(base, "cursor-default text-muted-foreground/80")}
              >
                {content}
              </span>
            ) : (
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  base,
                  "font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  active
                    ? "bg-background text-foreground shadow-[0_1px_2px_rgb(26_21_18/0.06)]"
                    : "text-stone hover:bg-background/70 hover:text-foreground",
                )}
              >
                {content}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
