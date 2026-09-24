import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { authLinks } from "@/lib/nav";
import { site } from "@/lib/site";
import { HeroDemo } from "./hero-demo";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-border">
      {/* Cream wash and fine vertical lines behind the demo */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-[26rem] bottom-0 -z-10 bg-linear-to-b from-background via-cream to-cream sm:top-[30rem]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-[26rem] -z-10 h-40 bg-[repeating-linear-gradient(90deg,rgb(26_21_18/0.06)_0_1px,transparent_1px_7px)] mask-[linear-gradient(to_bottom,black,transparent)] sm:top-[30rem]"
      />

      <div className="mx-auto flex max-w-[1440px] flex-col items-center px-4 pt-16 text-center sm:px-6 sm:pt-24">
        <Link
          href="/best-subreddits-for-freelancers"
          className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-background pr-2.5 pl-3.5 text-sm font-medium text-foreground/90 transition-colors duration-300 ease-snappy hover:border-input hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Best subreddits for freelancers in 2026
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3.5 text-muted-foreground"
          />
        </Link>

        <h1 className="mt-6 font-heading text-[2.75rem] leading-[0.95] font-semibold tracking-[-0.025em] text-balance sm:text-[4rem]">
          Get hired off Reddit.
        </h1>

        <p className="mt-5 max-w-[33rem] text-lg leading-[1.35] font-medium text-pretty text-muted-foreground">
          {site.oneLiner}
        </p>

        <div className="mt-8 flex w-full flex-col-reverse gap-2.5 sm:w-auto sm:flex-row">
          <Link
            href="/#how-it-works"
            className={buttonVariants({
              variant: "outline",
              size: "xl",
              className: "sm:h-9 sm:rounded-[10px] sm:px-3.5 sm:text-sm",
            })}
          >
            See how it works
          </Link>
          <Link
            href={authLinks.signUp.href}
            className={buttonVariants({
              size: "xl",
              className: "sm:h-9 sm:rounded-[10px] sm:px-3.5 sm:text-sm",
            })}
          >
            {authLinks.signUp.title}
          </Link>
        </div>
      </div>

      <figure className="mx-auto mt-14 max-w-[70rem] px-3 pb-16 sm:mt-20 sm:px-6 sm:pb-24">
        <figcaption className="sr-only">
          Preview of Redlance: new hiring posts from Reddit are scored against
          your skills with a short reason, and the best match gets a drafted
          reply that you copy and send yourself.
        </figcaption>
        <HeroDemo />
      </figure>
    </section>
  );
}
