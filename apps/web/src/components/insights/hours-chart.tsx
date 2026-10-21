import {
  hourLabel,
  hourSpan,
  hoursSentence,
  inStretch,
  zoneName,
} from "@/lib/insights-view";
import { cn } from "@/lib/utils";

// When hiring posts arrive, in the user's time zone: 24 hourly bars, one hue. The busiest
// 4-hour stretch is drawn in ink, the rest in the quiet `feed` tone; axis labels every
// 6 hours, no gridlines. Each bar has a native tooltip; the same numbers are in a table
// under "Show as a table" for screen readers and anyone who wants exact counts.

const AXIS = [0, 6, 12, 18];

export function HoursChart({
  hours,
  busiestStartHour,
  pattern,
  timeZone,
}: {
  hours: number[];
  busiestStartHour: number;
  pattern: "weekdays" | "weekends" | "all week";
  timeZone: string;
}) {
  const max = Math.max(1, ...hours);
  const sentence = hoursSentence(busiestStartHour, pattern);
  const busiest = hourSpan(busiestStartHour, 4);
  return (
    <figure>
      <figcaption className="text-sm text-foreground">{sentence}</figcaption>
      <p className="mt-0.5 text-[13px] text-stone">
        Times are {zoneName(timeZone)} time. Dark bars: {busiest}, the busiest 4
        hours.
      </p>
      <div className="mt-4" role="img" aria-label={sentence}>
        <div className="grid h-28 grid-cols-24 items-end gap-[2px] border-b border-border">
          {hours.map((n, h) => (
            <div
              key={h}
              title={`${hourSpan(h, 1)}: ${n} ${n === 1 ? "post" : "posts"}`}
              className="flex h-full items-end"
            >
              <div
                className={cn(
                  "w-full rounded-t-[3px]",
                  inStretch(h, busiestStartHour) ? "bg-ink" : "bg-feed",
                )}
                style={{
                  height: n === 0 ? 0 : `max(2px, ${(n / max) * 100}%)`,
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-24 text-[11px] text-stone tabular-nums">
          {AXIS.map((h) => (
            <span
              key={h}
              style={{ gridColumnStart: h + 1 }}
              className="col-span-6"
            >
              {hourLabel(h)}
            </span>
          ))}
        </div>
      </div>
      <details className="mt-3 text-[13px]">
        <summary className="cursor-pointer text-stone select-none hover:text-foreground">
          Show as a table
        </summary>
        <table className="mt-2 w-full max-w-xs text-left tabular-nums">
          <caption className="sr-only">
            Hiring posts by hour of the day, last 28 days, {zoneName(timeZone)}{" "}
            time
          </caption>
          <thead>
            <tr className="text-stone">
              <th scope="col" className="py-1 font-medium">
                Hour
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Posts
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {hours.map((n, h) => (
              <tr
                key={h}
                className={inStretch(h, busiestStartHour) ? "font-medium" : ""}
              >
                <th scope="row" className="py-1 font-normal">
                  {hourSpan(h, 1)}
                </th>
                <td className="py-1 text-right">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
