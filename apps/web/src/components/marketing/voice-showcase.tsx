import {
  AlignLeftIcon,
  Link2Icon,
  MessageSquareQuoteIcon,
  TargetIcon,
} from "lucide-react";
import { Horizon } from "./motion/horizon";
import { Streaks } from "./motion/streaks";
import { Frame } from "./primitives";

const points = [
  {
    icon: MessageSquareQuoteIcon,
    title: "Learns your tone.",
    body: "Paste a few replies you've written and drafts start to sound like them.",
  },
  {
    icon: TargetIcon,
    title: "Names their problem.",
    body: "Every draft points at what the client actually asked for.",
  },
  {
    icon: AlignLeftIcon,
    title: "Short on purpose.",
    body: "Three or four sentences. Busy clients read short replies.",
  },
  {
    icon: Link2Icon,
    title: "One link, not ten.",
    body: "The closest piece of your work, instead of your whole portfolio.",
  },
];

export function VoiceShowcase() {
  return (
    <section
      aria-labelledby="voice-heading"
      data-header-theme="dark"
      className="dark border-b border-border bg-background text-foreground"
    >
      <Frame>
        <div className="relative isolate flex h-[26rem] flex-col items-center overflow-clip px-4 pt-20 text-center sm:h-[34rem] sm:pt-28">
          {/* Light streaks drifting down, fading out toward the horizon */}
          <Streaks
            count={36}
            className="-z-20 mask-[linear-gradient(to_bottom,black_10%,transparent_65%)] text-bone/40"
          />
          <Horizon />

          <p className="reveal-blur text-base text-muted-foreground">
            Replies that sound like you
          </p>
          <h2
            id="voice-heading"
            className="mt-3 reveal-blur font-heading text-[3.25rem] leading-none font-semibold tracking-[-0.03em] sm:text-[6rem]"
          >
            Voice Match
          </h2>
        </div>

        <ul className="grid border-t border-border sm:grid-cols-2 lg:grid-cols-4">
          {points.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="flex flex-col gap-10 border-border px-6 py-8 not-last:border-b sm:px-8 sm:odd:border-r lg:not-last:border-r lg:not-last:border-b-0"
            >
              <Icon
                aria-hidden="true"
                className="size-6 text-muted-foreground"
                strokeWidth={1.5}
              />
              <div className="flex flex-col gap-1.5">
                <p className="text-[17px] font-medium tracking-[-0.01em]">
                  {title}
                </p>
                <p className="leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Frame>
    </section>
  );
}
