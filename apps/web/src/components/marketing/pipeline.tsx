import {
  InboxIcon,
  PenLineIcon,
  ScanSearchIcon,
  SendIcon,
  TargetIcon,
  UserRoundCheckIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// The core loop as a small workflow canvas (fixed 520×300 px, desktop only).
const W = 156;
const H = 64;
const nodes = [
  {
    x: 0,
    y: 30,
    icon: InboxIcon,
    title: "New post",
    sub: "r/forhire",
  },
  {
    x: 182,
    y: 30,
    icon: ScanSearchIcon,
    title: "Understand",
    sub: "Skills, budget",
  },
  {
    x: 364,
    y: 30,
    icon: TargetIcon,
    title: "Match",
    sub: "94 / 100",
    accent: true,
  },
  { x: 364, y: 196, icon: SendIcon, title: "Alert", sub: "Telegram" },
  { x: 182, y: 196, icon: PenLineIcon, title: "Draft", sub: "Comment, DM" },
  {
    x: 0,
    y: 196,
    icon: UserRoundCheckIcon,
    title: "You send",
    sub: "Your account",
    human: true,
  },
];
const connectors = [
  "M156 62 H182",
  "M338 62 H364",
  "M442 94 V196",
  "M364 228 H338",
  "M182 228 H156",
];
const route = "M78 62 H442 V228 H78";

export function Pipeline({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative h-[300px] w-[520px] shrink-0", className)}
    >
      <svg
        viewBox="0 0 520 300"
        className="absolute inset-0 size-full overflow-visible"
      >
        {connectors.map((d, i) => (
          <path
            key={d}
            d={d}
            fill="none"
            strokeWidth="1.5"
            pathLength={1}
            strokeDasharray="1"
            className="animate-draw stroke-foreground/25 [animation-duration:0.6s]"
            style={{ animationDelay: `${0.5 + i * 0.35}s` }}
          />
        ))}
      </svg>
      {/* A dot travelling the route, behind the nodes */}
      <span
        className="absolute top-0 left-0 size-2 animate-travel rounded-full bg-flare-500 shadow-[0_0_10px_2px_rgb(255_90_31/0.55)] [animation-delay:2.4s] motion-reduce:hidden"
        style={{ offsetPath: `path("${route}")`, offsetDistance: "0%" }}
      />
      {nodes.map(({ x, y, icon: Icon, title, sub, accent, human }, i) => (
        <div
          key={title}
          className={cn(
            "absolute flex animate-enter items-center gap-2.5 rounded-xl border px-3 shadow-sm",
            human
              ? "border-ink bg-ink text-bone"
              : "border-border bg-background",
          )}
          style={{
            left: x,
            top: y,
            width: W,
            height: H,
            animationDelay: `${0.15 + i * 0.35}s`,
          }}
        >
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-lg",
              human
                ? "bg-bone/10"
                : accent
                  ? "bg-flare-50 text-flare-600"
                  : "bg-muted text-muted-foreground",
            )}
          >
            <Icon className="size-4" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[13px] font-semibold">{title}</span>
            <span
              className={cn(
                "truncate text-[11px]",
                human
                  ? "text-bone/70"
                  : accent
                    ? "font-medium text-flare-700"
                    : "text-muted-foreground",
              )}
            >
              {sub}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
