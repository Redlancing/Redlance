export type Poller = {
  /** Stops the schedule; an in-flight call finishes but its result is ignored. */
  pause(): void;
  /** Starts again after `intervalMs` (not at once). No effect once finished. */
  resume(): void;
  /** Stops for good. */
  stop(): void;
  readonly finished: boolean;
};

export type PollerOptions<T> = {
  fn: () => Promise<T>;
  /** Wait between the end of one call and the start of the next. */
  intervalMs: number;
  /** Wait before the first call (default: `intervalMs`). */
  firstDelayMs?: number;
  /** Give up this long after creation (paused time counts). */
  timeoutMs: number;
  isDone: (value: T) => boolean;
  onResult?: (value: T) => void;
  onTimeout?: () => void;
  /** Injected in tests. */
  clock?: {
    now(): number;
    setTimeout(cb: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
};

const realClock = {
  now: () => Date.now(),
  setTimeout: (cb: () => void, ms: number): unknown => setTimeout(cb, ms),
  clearTimeout: (h: unknown) =>
    clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * A polling schedule with no overlap: the next call is scheduled only after the last one
 * settles. It stops when `isDone` says so or when `timeoutMs` has passed, and can be paused
 * (a hidden tab) and resumed. A call that throws counts as "not done" and polling goes on.
 */
export function createPoller<T>(opts: PollerOptions<T>): Poller {
  const clock = opts.clock ?? realClock;
  const deadline = clock.now() + opts.timeoutMs;
  let timer: unknown = null;
  let paused = false;
  let finished = false;
  let running = false;

  function finish() {
    finished = true;
    clearTimer();
  }
  function clearTimer() {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  }
  function schedule(delay: number) {
    clearTimer();
    if (finished || paused || running) return;
    timer = clock.setTimeout(() => void tick(), delay);
  }

  async function tick() {
    timer = null;
    if (finished || paused) return;
    if (clock.now() >= deadline) {
      finish();
      opts.onTimeout?.();
      return;
    }
    running = true;
    let value: T | undefined;
    let ok = false;
    try {
      value = await opts.fn();
      ok = true;
    } catch {
      // A failed call is retried on the next tick.
    }
    running = false;
    if (finished) return;
    // A pause during the call drops its result; resume() will poll again.
    if (paused) return;
    if (ok) {
      opts.onResult?.(value as T);
      if (opts.isDone(value as T)) {
        finish();
        return;
      }
    }
    if (clock.now() >= deadline) {
      finish();
      opts.onTimeout?.();
      return;
    }
    schedule(opts.intervalMs);
  }

  schedule(opts.firstDelayMs ?? opts.intervalMs);

  return {
    pause() {
      paused = true;
      clearTimer();
    },
    resume() {
      if (finished || !paused) return;
      paused = false;
      schedule(opts.intervalMs);
    },
    stop: finish,
    get finished() {
      return finished;
    },
  };
}
