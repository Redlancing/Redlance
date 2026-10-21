import { cn } from "cn";
import { STATUS_LABELS, type ReplyStatus } from "./tracker-state";

const TONE: Record<ReplyStatus, string> = {
  sent: "bg-flare-50 text-flare-700",
  replied: "bg-ink text-cream",
  hired: "bg-success-soft text-success",
  lost: "bg-bone text-stone",
  no_reply: "bg-bone text-stone",
  ghosted: "bg-bone text-stone",
};

export function StatusChip({
  status,
  className,
}: {
  status: ReplyStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium transition-colors duration-120",
        TONE[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
