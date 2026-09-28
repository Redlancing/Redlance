import {
  AlignLeftIcon,
  Link2Icon,
  PenLineIcon,
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
    body: "Drafts pick it up from replies you've written.",
  },
  {
    icon: TargetIcon,
    title: "Names their problem.",
    body: "Every draft points at what the client asked.",
  },
  {
    icon: AlignLeftIcon,
    title: "Short on purpose.",
    body: "Three or four sentences. Clients read those.",
  },
  {
    icon: Link2Icon,
    title: "One link, not ten.",
    body: "Your closest work, not your whole portfolio.",
  },
  {
    icon: PenLineIcon,
    title: "Better with every edit.",
    body: "On Pro, your changes teach it how you write.",
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
          {/* Attio's even line grid with a few faint travelling highlights */}
          <Streaks travel={560} className="-z-20" />
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

        {/* Square cells, icon at the top and text at the bottom, as on Attio */}
        <ul className="grid grid-cols-1 border-t border-border lg:grid-cols-5">
          {points.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="flex flex-col justify-between gap-4 border-border px-6 py-8 not-first:border-t max-lg:items-center max-lg:text-center lg:aspect-square lg:gap-8 lg:px-7 lg:not-first:border-t-0 lg:not-first:border-l 2xl:aspect-[5/4]"
            >
              <Icon
                aria-hidden="true"
                className="size-6 text-muted-foreground"
                strokeWidth={1.5}
              />
              <div className="flex flex-col gap-1.5 lg:min-h-[5.25rem]">
                <p className="text-[17px] font-medium tracking-[-0.01em]">
                  {title}
                </p>
                <p className="max-w-[18rem] leading-relaxed text-pretty text-muted-foreground">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Frame>
    </section>
  );
}
