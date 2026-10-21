export type DisabledReason = "blocked" | "user_stop" | "relinked";

export type TelegramSettings = {
  linked: boolean;
  enabled: boolean;
  disabledReason: DisabledReason | null;
};

export type Phase =
  | "idle"
  | "linking"
  | "waiting"
  | "connected"
  | "expired"
  | "error"
  | "unavailable";

export type LocalState = {
  phase: Phase;
  /** Epoch ms when the current link stops working (waiting only). */
  expiresAt: number | null;
  /** How long the settings poll may run (waiting only). */
  waitMs: number;
  /** Set when the browser blocked the new tab, so the user can open the link themselves. */
  fallbackUrl: string | null;
  /** User-facing text for the "error" phase. */
  error: string | null;
};

export type Action =
  | { type: "start" }
  | {
      type: "linkCreated";
      expiresAt: number;
      now: number;
      /** Present only when window.open was blocked. */
      fallbackUrl?: string | null;
    }
  | { type: "linkFailed"; code: string; message: string }
  | { type: "settings"; settings: TelegramSettings }
  | { type: "expire" }
  | { type: "disconnected" };

export const initialLocal: LocalState = {
  phase: "idle",
  expiresAt: null,
  waitMs: 0,
  fallbackUrl: null,
  error: null,
};

const isOn = (s: TelegramSettings) => s.linked && s.enabled;

export function reduce(state: LocalState, action: Action): LocalState {
  switch (action.type) {
    case "start":
      if (state.phase === "linking") return state;
      return { ...initialLocal, phase: "linking" };
    case "linkCreated":
      if (state.phase !== "linking") return state;
      return {
        phase: "waiting",
        expiresAt: action.expiresAt,
        waitMs: Math.max(0, action.expiresAt - action.now),
        fallbackUrl: action.fallbackUrl ?? null,
        error: null,
      };
    case "linkFailed":
      if (state.phase !== "linking") return state;
      return action.code === "TELEGRAM_UNAVAILABLE"
        ? { ...initialLocal, phase: "unavailable" }
        : { ...initialLocal, phase: "error", error: action.message };
    case "settings":
      if (isOn(action.settings)) {
        // A poll that lands after the user left the waiting state must not resurrect it.
        return state.phase === "linking"
          ? state
          : { ...initialLocal, phase: "connected" };
      }
      // Linked-and-off while waiting is the old state; keep waiting.
      return state.phase === "connected" ? { ...initialLocal } : state;
    case "expire":
      return state.phase === "waiting"
        ? { ...initialLocal, phase: "expired" }
        : state;
    case "disconnected":
      return { ...initialLocal };
  }
}

export type View =
  | { kind: "loading" }
  | { kind: "connected" }
  | { kind: "linking" }
  | { kind: "waiting"; fallbackUrl: string | null }
  | { kind: "expired" }
  | { kind: "error"; message: string }
  | { kind: "unavailable" }
  | { kind: "off"; reason: DisabledReason | null }
  | { kind: "notLinked" };

/** What to show: an in-progress local phase wins over the saved settings. */
export function deriveView(
  settings: TelegramSettings | null,
  local: LocalState,
): View {
  switch (local.phase) {
    case "linking":
      return { kind: "linking" };
    case "waiting":
      return { kind: "waiting", fallbackUrl: local.fallbackUrl };
    case "expired":
      return { kind: "expired" };
    case "error":
      return { kind: "error", message: local.error ?? "" };
    case "unavailable":
      return { kind: "unavailable" };
    default:
      break;
  }
  if (!settings) return { kind: "loading" };
  if (isOn(settings)) return { kind: "connected" };
  if (settings.linked) return { kind: "off", reason: settings.disabledReason };
  return { kind: "notLinked" };
}

const REASON_COPY: Record<DisabledReason, string> = {
  user_stop: "You turned alerts off.",
  blocked: "Telegram says you blocked the bot.",
  relinked:
    "This Telegram account is now connected to another Redlance account.",
};

export function disabledReasonCopy(reason: DisabledReason | null): string {
  return reason ? REASON_COPY[reason] : "Alerts are off.";
}

export const ALERT_MIN_SCORE = 50;
export const ALERT_MAX_SCORE = 100;
export const ALERT_SCORE_STEP = 5;

/** Snaps a saved minimum score onto the stepper's range and step. */
export function snapScore(value: number): number {
  const snapped = Math.round(value / ALERT_SCORE_STEP) * ALERT_SCORE_STEP;
  return Math.min(ALERT_MAX_SCORE, Math.max(ALERT_MIN_SCORE, snapped));
}

/** The band a minimum score alerts for: matches this strong or better. */
export function scoreBandLabel(score: number): string {
  if (score >= 85) return "Strong matches only";
  if (score >= 70) return "Good matches and up";
  return "Fair matches and up";
}

export function clampDailyCap(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(100, Math.max(1, Math.round(value)));
}
