import { cn } from "@/lib/utils";

// Deterministic pseudo-random in [0, 1), so server output is stable.
function rand(i: number, salt: number) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const LINE_HEIGHT = 360;
const SPEED = 225; // px per second, measured on Attio

/**
 * Attio's fine-line texture for dark sections, measured from their page:
 * 1. an even grid of 1px lines every 8px at 3.5% opacity, covering the area,
 * 2. a few faint highlights (360px tall, bright in the middle) that travel
 *    down the full height at ~225px/s.
 * `travel` is roughly the height of the area the highlights cross. Light
 * sections pass their own `grid` colour, 1px lines and stronger highlights.
 */
export function Streaks({
  count = 6,
  travel = 700,
  highlight = "rgb(255 255 255 / 0.5)",
  grid = "rgb(247 242 236 / 0.035)",
  lineWidth = 2,
  maxOpacity = 0.25,
  className,
}: {
  count?: number;
  travel?: number;
  highlight?: string;
  grid?: string;
  lineWidth?: number;
  maxOpacity?: number;
  className?: string;
}) {
  const duration = (travel + LINE_HEIGHT) / SPEED;
  const lines = Array.from({ length: count }, (_, i) => ({
    left: `${(((i + rand(i, 1)) / count) * 100).toFixed(2)}%`,
    delay: `${-(rand(i, 2) * duration).toFixed(2)}s`,
    duration: `${(duration * (0.9 + rand(i, 3) * 0.2)).toFixed(2)}s`,
    opacity: (0.1 + rand(i, 4) * (maxOpacity - 0.1)).toFixed(3),
    width: (0.65 + rand(i, 5) * 0.35).toFixed(3),
  }));

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `repeating-linear-gradient(to right, ${grid} 0 1px, transparent 1px 8px)`,
        }}
      />
      {lines.map((line, i) => (
        <span
          key={i}
          className="absolute top-0 origin-top-left animate-streak opacity-0"
          style={
            {
              left: line.left,
              width: lineWidth,
              height: LINE_HEIGHT,
              scale: `${line.width} 1`,
              background: `linear-gradient(transparent, ${highlight} 50%, transparent)`,
              animationDelay: line.delay,
              animationDuration: line.duration,
              "--streak-opacity": line.opacity,
              "--streak-travel": `${travel}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
