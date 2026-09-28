import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { appNav } from "./app-nav";
import { SignOutButton } from "./sign-out-button";

export function AppSidebar({
  email,
  activeHref,
}: {
  email: string;
  activeHref: string;
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-bone md:flex">
      <div className="px-5 py-5">
        <Link
          href="/dashboard"
          aria-label="Redlance dashboard"
          className="inline-flex rounded-md text-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Logo />
        </Link>
      </div>
      <nav aria-label="App" className="flex-1 px-3">
        <ul className="space-y-0.5">
          {appNav.map(({ title, href, icon: Icon, soon }) => {
            const active = href === activeHref;
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
            const base =
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm";
            return (
              <li key={href}>
                {soon ? (
                  <span
                    aria-disabled="true"
                    className={cn(
                      base,
                      "cursor-default text-muted-foreground/80",
                    )}
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
      </nav>
      <div className="border-t border-border px-3 py-3">
        <p
          className="truncate px-2.5 pb-2 text-xs text-muted-foreground"
          title={email}
        >
          {email}
        </p>
        <SignOutButton className="w-full justify-start" />
      </div>
    </aside>
  );
}
