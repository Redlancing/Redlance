import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { AppNavLinks } from "./app-nav-links";
import { SignOutButton } from "./sign-out-button";

export function AppSidebar({ email }: { email: string }) {
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
        <AppNavLinks />
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
