const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatter.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatter.set(timeZone, f);
  }
  return f;
}

/** The zone's offset from UTC at `at`, in ms (positive east of Greenwich). */
function offsetMs(timeZone: string, at: Date): number {
  const p = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Midnight of `now`'s day in `timeZone`, as a UTC instant (for the daily alert cap).
 * DST-safe: the offset is taken at midnight itself, not at `now`. Unknown zones use UTC.
 */
export function startOfLocalDay(timeZone: string, now: Date): Date {
  let zone = timeZone;
  try {
    formatterFor(zone);
  } catch {
    zone = "UTC";
  }
  const local = new Date(now.getTime() + offsetMs(zone, now));
  const midnightAsUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  // Guess with today's offset, then correct with the offset at that instant.
  const guess = midnightAsUtc - offsetMs(zone, now);
  return new Date(midnightAsUtc - offsetMs(zone, new Date(guess)));
}

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;

/** Wait before retrying a delivery after its `attempts`-th try: 30 s doubling, max 30 min. */
export function deliveryBackoffMs(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(BACKOFF_BASE_MS * 2 ** (n - 1), BACKOFF_MAX_MS);
}
