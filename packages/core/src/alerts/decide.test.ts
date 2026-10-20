import { describe, expect, it } from "vitest";
import { decideAlert, type AlertInput } from "./decide";

const now = new Date("2026-10-20T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

const base = (over: Partial<AlertInput> = {}): AlertInput => ({
  match: {
    score: 84,
    postedAt: minutesAgo(6),
    withdrawn: false,
    status: "new",
  },
  user: {
    plan: "trial",
    trialEndsAt: new Date("2026-10-24T00:00:00Z"),
    alertMinScore: 70,
    dailyCap: 20,
    routedToday: 0,
  },
  telegram: { enabled: true, verified: true },
  telegramAvailable: true,
  maxAgeHours: 24,
  ...over,
});
const withMatch = (m: Partial<AlertInput["match"]>) =>
  base({ match: { ...base().match, ...m } });
const withUser = (u: Partial<AlertInput["user"]>) =>
  base({ user: { ...base().user, ...u } });

describe("decideAlert", () => {
  it("queues a fresh, strong match for a linked user", () => {
    expect(decideAlert(base(), now)).toEqual({
      outcome: "queued",
      channels: ["telegram"],
    });
  });

  it("skips withdrawn and dismissed matches", () => {
    expect(decideAlert(withMatch({ withdrawn: true }), now).outcome).toBe(
      "skipped_withdrawn",
    );
    expect(decideAlert(withMatch({ status: "dismissed" }), now).outcome).toBe(
      "skipped_withdrawn",
    );
  });

  it("uses the user's threshold (inclusive)", () => {
    expect(decideAlert(withMatch({ score: 69 }), now).outcome).toBe(
      "below_threshold",
    );
    expect(decideAlert(withMatch({ score: 70 }), now).outcome).toBe("queued");
    expect(
      decideAlert(
        base({
          match: { ...base().match, score: 60 },
          user: { ...base().user, alertMinScore: 60 },
        }),
        now,
      ).outcome,
    ).toBe("queued");
  });

  it("skips posts older than maxAgeHours", () => {
    expect(
      decideAlert(withMatch({ postedAt: minutesAgo(24 * 60 + 1) }), now)
        .outcome,
    ).toBe("skipped_stale");
    expect(
      decideAlert(withMatch({ postedAt: minutesAgo(24 * 60) }), now).outcome,
    ).toBe("queued");
  });

  it("checks the threshold before age", () => {
    const input = withMatch({ score: 10, postedAt: minutesAgo(5000) });
    expect(decideAlert(input, now).outcome).toBe("below_threshold");
  });

  it("skips an ended trial but not a paid plan", () => {
    const ended = new Date("2026-10-19T00:00:00Z");
    expect(decideAlert(withUser({ trialEndsAt: ended }), now).outcome).toBe(
      "skipped_trial",
    );
    expect(
      decideAlert(withUser({ trialEndsAt: ended, plan: "standard" }), now)
        .outcome,
    ).toBe("queued");
  });

  it("skips once the daily cap is reached", () => {
    expect(decideAlert(withUser({ routedToday: 19 }), now).outcome).toBe(
      "queued",
    );
    expect(decideAlert(withUser({ routedToday: 20 }), now).outcome).toBe(
      "skipped_cap",
    );
  });

  it("skips without a usable Telegram channel", () => {
    const cases: Partial<AlertInput>[] = [
      { telegram: null },
      { telegram: { enabled: false, verified: true } },
      { telegram: { enabled: true, verified: false } },
      { telegramAvailable: false },
    ];
    for (const c of cases) {
      expect(decideAlert(base(c), now)).toEqual({
        outcome: "skipped_no_channel",
        channels: [],
      });
    }
  });

  it("checks the cap before the channel", () => {
    const input = base({
      telegram: null,
      user: { ...base().user, routedToday: 20 },
    });
    expect(decideAlert(input, now).outcome).toBe("skipped_cap");
  });
});
