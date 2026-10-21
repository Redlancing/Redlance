import { describe, expect, it } from "vitest";
import {
  clampDailyCap,
  deriveView,
  disabledReasonCopy,
  initialLocal,
  reduce,
  scoreBandLabel,
  snapScore,
  type LocalState,
  type TelegramSettings,
} from "./telegram-state";

const off: TelegramSettings = {
  linked: false,
  enabled: false,
  disabledReason: null,
};
const on: TelegramSettings = {
  linked: true,
  enabled: true,
  disabledReason: null,
};

function waiting(): LocalState {
  let s = reduce(initialLocal, { type: "start" });
  s = reduce(s, { type: "linkCreated", now: 1000, expiresAt: 61000 });
  return s;
}

describe("reduce", () => {
  it("idle -> linking -> waiting with a wait window", () => {
    const s = waiting();
    expect(s.phase).toBe("waiting");
    expect(s.waitMs).toBe(60000);
  });

  it("keeps the fallback url when the tab was blocked", () => {
    let s = reduce(initialLocal, { type: "start" });
    s = reduce(s, {
      type: "linkCreated",
      now: 0,
      expiresAt: 5,
      fallbackUrl: "https://t.me/x",
    });
    expect(deriveView(off, s)).toEqual({
      kind: "waiting",
      fallbackUrl: "https://t.me/x",
    });
  });

  it("ignores a second start while linking", () => {
    const s = reduce(initialLocal, { type: "start" });
    expect(reduce(s, { type: "start" })).toBe(s);
  });

  it("waiting -> connected when settings show linked and enabled", () => {
    expect(reduce(waiting(), { type: "settings", settings: on }).phase).toBe(
      "connected",
    );
  });

  it("keeps waiting while settings still say off", () => {
    const s = waiting();
    expect(reduce(s, { type: "settings", settings: off })).toBe(s);
  });

  it("waiting -> expired, and only from waiting", () => {
    expect(reduce(waiting(), { type: "expire" }).phase).toBe("expired");
    expect(reduce(initialLocal, { type: "expire" })).toBe(initialLocal);
  });

  it("503 becomes unavailable, other failures an error with the message", () => {
    const l = reduce(initialLocal, { type: "start" });
    expect(
      reduce(l, {
        type: "linkFailed",
        code: "TELEGRAM_UNAVAILABLE",
        message: "x",
      }).phase,
    ).toBe("unavailable");
    const e = reduce(l, {
      type: "linkFailed",
      code: "RATE_LIMITED",
      message: "Slow down",
    });
    expect(e).toMatchObject({ phase: "error", error: "Slow down" });
  });

  it("a late link result after leaving linking is ignored", () => {
    expect(
      reduce(initialLocal, { type: "linkCreated", now: 0, expiresAt: 10 }),
    ).toBe(initialLocal);
  });

  it("a stale poll result does not end linking", () => {
    const l = reduce(initialLocal, { type: "start" });
    expect(reduce(l, { type: "settings", settings: on })).toBe(l);
  });

  it("disconnected resets", () => {
    expect(
      reduce({ ...initialLocal, phase: "connected" }, { type: "disconnected" }),
    ).toEqual(initialLocal);
  });
});

describe("deriveView", () => {
  it("loading without settings", () => {
    expect(deriveView(null, initialLocal)).toEqual({ kind: "loading" });
  });
  it("not linked, connected, and off with each reason", () => {
    expect(deriveView(off, initialLocal).kind).toBe("notLinked");
    expect(deriveView(on, initialLocal).kind).toBe("connected");
    expect(
      deriveView(
        { linked: true, enabled: false, disabledReason: "blocked" },
        initialLocal,
      ),
    ).toEqual({ kind: "off", reason: "blocked" });
  });
  it("a local phase wins over settings", () => {
    expect(deriveView(on, { ...initialLocal, phase: "linking" }).kind).toBe(
      "linking",
    );
    expect(
      deriveView(null, { ...initialLocal, phase: "unavailable" }).kind,
    ).toBe("unavailable");
  });
});

describe("copy and numbers", () => {
  it("has copy for every disabled reason", () => {
    expect(disabledReasonCopy("user_stop")).toBe("You turned alerts off.");
    expect(disabledReasonCopy("blocked")).toBe(
      "Telegram says you blocked the bot.",
    );
    expect(disabledReasonCopy("relinked")).toContain(
      "another Redlance account",
    );
    expect(disabledReasonCopy(null)).toBe("Alerts are off.");
  });
  it("snaps scores to 50-100 in steps of 5", () => {
    expect(snapScore(0)).toBe(50);
    expect(snapScore(72)).toBe(70);
    expect(snapScore(73)).toBe(75);
    expect(snapScore(100)).toBe(100);
    expect(snapScore(400)).toBe(100);
  });
  it("labels bands", () => {
    expect(scoreBandLabel(85)).toBe("Strong matches only");
    expect(scoreBandLabel(70)).toBe("Good matches and up");
    expect(scoreBandLabel(55)).toBe("Fair matches and up");
  });
  it("clamps the daily cap", () => {
    expect(clampDailyCap(0)).toBe(1);
    expect(clampDailyCap(250)).toBe(100);
    expect(clampDailyCap(12.4)).toBe(12);
    expect(clampDailyCap(NaN)).toBe(1);
  });
});
