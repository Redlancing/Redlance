import { cn } from "@/lib/utils";

/** The page frame: 1440px max width with thin vertical rails, as in the Attio teardown. */
export function Frame({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1440px] sm:px-6">
      <div className={cn("sm:border-x sm:border-border", className)}>
        {children}
      </div>
    </div>
  );
}

/** Small orange label that names a section. */
export function SectionChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center rounded-lg bg-flare-50 px-1.5 text-sm font-medium text-flare-700">
      {children}
    </span>
  );
}

type HeadingTag = "h2" | "h3";

/** A short claim in ink followed by detail in grey, in one heading. */
export function TwoToneHeading({
  as: Tag = "h2",
  lead,
  rest,
  className,
  id,
}: {
  as?: HeadingTag;
  lead: string;
  rest: string;
  className?: string;
  id?: string;
}) {
  return (
    <Tag
      id={id}
      className={cn(
        "font-heading font-medium text-pretty",
        Tag === "h2"
          ? "text-[1.875rem] leading-[1.1] tracking-[-0.02em] sm:text-[2.5rem]"
          : "text-[1.375rem] leading-[1.15] tracking-[-0.015em] sm:text-2xl",
        className,
      )}
    >
      {lead} <span className="text-muted-foreground">{rest}</span>
    </Tag>
  );
}
