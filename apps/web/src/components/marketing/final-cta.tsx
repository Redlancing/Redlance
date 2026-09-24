import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { authLinks } from "@/lib/nav";
import { Streaks } from "./motion/streaks";
import { Frame } from "./primitives";

export function FinalCta() {
  return (
    <section
      aria-labelledby="final-cta-heading"
      data-header-theme="dark"
      className="dark border-b border-border bg-background text-foreground"
    >
      <Frame>
        <div className="relative isolate flex flex-col items-center px-4 py-24 text-center sm:py-32">
          <Streaks
            count={40}
            className="-z-10 mask-[linear-gradient(to_top,black,transparent_85%)] text-bone/35"
          />
          <h2
            id="final-cta-heading"
            className="max-w-[40rem] reveal-blur font-heading text-[2.5rem] leading-none font-medium tracking-[-0.025em] text-balance sm:text-[3.5rem]"
          >
            Your next client is posting right now.
          </h2>
          <div className="mt-10 flex w-full flex-col-reverse gap-2.5 sm:w-auto sm:flex-row">
            <Link
              href="/#pricing"
              className={buttonVariants({
                variant: "outline",
                size: "xl",
                className: "sm:h-9 sm:rounded-[10px] sm:px-3.5 sm:text-sm",
              })}
            >
              See pricing
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
      </Frame>
    </section>
  );
}
