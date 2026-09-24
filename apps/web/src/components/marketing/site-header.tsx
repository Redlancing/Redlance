import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { authLinks } from "@/lib/nav";
import { MainNav } from "./main-nav";
import { MobileNav } from "./mobile-nav";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md supports-backdrop-filter:bg-background/80">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-4 sm:px-6">
        <Link
          href="/"
          className="-m-1 rounded-md p-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Logo className="text-[22px]" />
        </Link>
        <MainNav className="hidden lg:flex" />
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={authLinks.logIn.href}
            className={buttonVariants({
              variant: "outline",
              size: "lg",
              className: "hidden text-sm md:inline-flex",
            })}
          >
            {authLinks.logIn.title}
          </Link>
          <Link
            href={authLinks.signUp.href}
            className={buttonVariants({
              size: "lg",
              className: "hidden sm:inline-flex",
            })}
          >
            {authLinks.signUp.title}
          </Link>
          <MobileNav className="lg:hidden" />
        </div>
      </div>
    </header>
  );
}
