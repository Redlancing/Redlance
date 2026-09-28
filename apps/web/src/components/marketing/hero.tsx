import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { authLinks } from "@/lib/nav";
import { site } from "@/lib/site";
import { HeroBackdrop } from "./hero-backdrop";
import { HeroDemo } from "./hero-demo";
import { HeroStage } from "./hero-stage";

// One orchestrated entrance on load (CSS, no JavaScript): each line sharpens
// in after the one before it.
const enter = (delay: number) => ({ animationDelay: `${delay}s` });

export function Hero() {
  return (
    <section className="relative isolate overflow-clip border-b border-border">
      <HeroBackdrop />

      <div className="mx-auto flex max-w-[1440px] scroll-fade-out flex-col items-center px-4 pt-16 text-center sm:px-6 sm:pt-24 lg:sticky lg:top-16">
        <Link
          href="/best-subreddits-for-freelancers"
          style={enter(0)}
          className="inline-flex h-8 animate-enter items-center gap-1 rounded-full border border-border bg-background pr-2.5 pl-3.5 text-sm font-medium text-foreground/90 transition-colors duration-300 ease-snappy hover:border-input hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Best subreddits for freelancers in 2026
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3.5 text-muted-foreground"
          />
        </Link>

        <h1
          style={enter(0.08)}
          className="mt-6 animate-enter font-heading text-[2.75rem] leading-[0.95] font-semibold tracking-[-0.025em] text-balance [animation-duration:0.7s] sm:text-[4rem]"
        >
          Get hired off Reddit.
        </h1>

        <p
          style={enter(0.18)}
          className="mt-5 max-w-[33rem] animate-enter text-lg leading-[1.35] font-medium text-pretty text-muted-foreground"
        >
          {site.oneLiner}
        </p>

        <div
          style={enter(0.28)}
          className="mt-8 flex w-full animate-enter flex-col-reverse gap-2.5 sm:w-auto sm:flex-row"
        >
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

      <figure
        style={enter(0.42)}
        className="relative z-10 mx-auto mt-14 max-w-[70rem] animate-enter px-3 pb-16 [animation-duration:1.1s] sm:mt-20 sm:px-6 sm:pb-24"
      >
        <figcaption className="sr-only">
          Preview of Redlance: new hiring posts from Reddit are scored against
          your skills with a short reason, and the best match gets a drafted
          reply that you copy and send yourself.
        </figcaption>
        <HeroStage>
          <HeroDemo />
        </HeroStage>
      </figure>
    </section>
  );
}
