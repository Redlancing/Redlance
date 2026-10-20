import { describe, expect, it } from "vitest";
import { checklistComplete, creditsLine, setupChecklist } from "./overview";

describe("setupChecklist", () => {
  it("marks steps from the inputs", () => {
    const items = setupChecklist({
      onboarded: true,
      telegramOn: false,
      sentEver: 0,
    });
    expect(items.map((i) => i.done)).toEqual([true, false, false]);
    expect(items.map((i) => i.href)).toEqual([
      "/onboarding",
      "/settings",
      "/feed",
    ]);
  });
  it("is complete only when all are done", () => {
    const all = setupChecklist({
      onboarded: true,
      telegramOn: true,
      sentEver: 2,
    });
    expect(checklistComplete(all)).toBe(true);
    const some = setupChecklist({
      onboarded: true,
      telegramOn: true,
      sentEver: 0,
    });
    expect(checklistComplete(some)).toBe(false);
  });
});

describe("creditsLine", () => {
  it("formats a paid plan", () => {
    expect(
      creditsLine({
        plan: "standard",
        balance: 2100,
        repliesLeft: 300,
        periodEnd: "2026-11-03T00:00:00.000Z",
      }),
    ).toBe("2,100 credits · about 300 replies left · resets Nov 3");
  });
  it("says trial ends for a trial", () => {
    expect(
      creditsLine({
        plan: "trial",
        balance: 210,
        repliesLeft: 30,
        periodEnd: "2026-10-25T10:00:00.000Z",
      }),
    ).toContain("trial ends Oct 25");
  });
  it("handles singular and missing date", () => {
    expect(
      creditsLine({ plan: "max", balance: 1, repliesLeft: 1, periodEnd: null }),
    ).toBe("1 credit · about 1 reply left");
  });
  it("is null without credits", () => {
    expect(
      creditsLine({ plan: null, balance: 0, repliesLeft: 0, periodEnd: null }),
    ).toBeNull();
  });
});
