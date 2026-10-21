"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { appTabs, isActiveHref } from "./app-nav";

/** Fixed bottom navigation on phones; the sidebar takes over from `md`. */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="App"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bone pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {appTabs.map(({ title, href, icon: Icon }) => {
          const active = isActiveHref(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-2 py-2 text-[11px] font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  active ? "text-foreground" : "text-stone",
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                {title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
