import { cn } from "@/lib/utils";

// Deterministic pseudo-random in [0, 1), so server output is stable.
function rand(i: number, salt: number) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Thin vertical light streaks that drift down through a masked strip, as on
 * Attio's section joins. Colour comes from the parent's text colour.
 */
export function Streaks({
  count = 24,
  className,
}: {
  count?: number;
  className?: string;
}) {
  const lines = Array.from({ length: count }, (_, i) => ({
    left: `${((i + rand(i, 1) * 0.8) / count) * 100}%`,
    delay: `${-(rand(i, 2) * 9).toFixed(2)}s`,
    duration: `${(5 + rand(i, 3) * 6).toFixed(2)}s`,
    opacity: (0.2 + rand(i, 4) * 0.55).toFixed(2),
  }));

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      {lines.map((line, i) => (
        <span
          key={i}
          className="absolute top-0 h-[22rem] w-px animate-streak bg-linear-to-b from-transparent via-current to-transparent opacity-0"
          style={
            {
              left: line.left,
              animationDelay: line.delay,
              animationDuration: line.duration,
              "--streak-opacity": line.opacity,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
