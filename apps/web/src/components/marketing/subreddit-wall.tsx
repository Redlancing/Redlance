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
            <li
              key={name}
              className="flex h-20 items-center justify-center bg-background px-3 text-center text-[15px] font-medium tracking-[-0.01em] break-all sm:h-24 sm:text-[17px]"
            >
              <span>
                <span className="text-muted-foreground">r/</span>
                {name}
              </span>
            </li>
          ))}
        </ul>
      </Frame>
    </section>
  );
}
