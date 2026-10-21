import { cn } from "@/lib/utils";
import { scoreBand } from "@/lib/format";

// Orange is kept for strong matches (brand rule: under ~10% of a screen).
const BAND_CLASS = {
  strong: "bg-flare-600 text-white",
  good: "bg-flare-50 text-flare-700",
  fair: "bg-bone text-stone",
} as const;

/** A match score, coloured by band: 85+ strong, 70+ good, else fair. */
export function ScoreChip({
  score,
  className,
}: {
  score: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 w-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold tabular-nums",
        BAND_CLASS[scoreBand(score)],
        className,
      )}
    >
      <span className="sr-only">Score </span>
      {score}
    </span>
  );
}
