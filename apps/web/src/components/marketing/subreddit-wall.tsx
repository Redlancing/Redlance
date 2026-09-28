import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { featuredSubreddits } from "@/lib/subreddits";
import { Frame } from "./primitives";

export function SubredditWall() {
  return (
    <section
      aria-labelledby="subreddit-wall-heading"
      className="border-b border-border"
    >
      <Frame>
        <h2
          id="subreddit-wall-heading"
          className="px-4 py-5 text-center text-sm text-muted-foreground"
        >
          Hiring posts from the subreddits clients actually use
        </h2>
        <ul className="grid grid-cols-2 gap-px border-t border-border bg-border md:grid-cols-5">
          {featuredSubreddits.map((name) => (
            <li key={name} className="bg-background">
              <Link
                href={`/best-subreddits-for-freelancers#r-${name.toLowerCase()}`}
                className="group relative flex h-20 items-center justify-center px-3 text-center text-[15px] font-medium tracking-[-0.01em] break-all transition-colors duration-200 ease-snappy hover:bg-cream focus-visible:bg-cream focus-visible:outline-none sm:h-24 sm:text-[17px]"
              >
                <span>
                  <span className="text-muted-foreground">r/</span>
                  {name}
                </span>
                <ArrowUpRightIcon
                  aria-hidden="true"
                  className="absolute top-3 right-3 size-3.5 -translate-x-0.5 translate-y-0.5 text-muted-foreground opacity-0 transition duration-200 ease-snappy group-hover:translate-0 group-hover:opacity-100 group-focus-visible:translate-0 group-focus-visible:opacity-100"
                />
              </Link>
            </li>
          ))}
        </ul>
      </Frame>
    </section>
  );
}
