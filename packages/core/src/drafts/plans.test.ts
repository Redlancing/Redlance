import { describe, expect, it } from "vitest";
import { PLANS } from "../matching/plans";
import {
  DAILY_COST_CAP_MICROS,
  DAILY_CREDIT_CAP,
  PLAN_CREDITS,
  REWRITE_OPTIONS,
  repliesLeft,
  taskForRewrite,
} from "./plans";

describe("taskForRewrite", () => {
  it("uses Flash to pick a different project", () => {
    expect(taskForRewrite("different_project")).toBe("rewrite_flash");
  });
  it("uses Flash-Lite for every other option", () => {
    for (const o of REWRITE_OPTIONS.filter((o) => o !== "different_project")) {
      expect(taskForRewrite(o)).toBe("rewrite_lite");
    }
  });
});

describe("repliesLeft", () => {
  it("is the balance divided by a draft's credits, rounded down", () => {
    expect(repliesLeft(2100)).toBe(300);
    expect(repliesLeft(6)).toBe(0);
  });
});

describe("plan tables", () => {
  it("has an entry for every plan in each table", () => {
    for (const p of PLANS) {
      expect(PLAN_CREDITS[p]).toBeGreaterThan(0);
      expect(DAILY_CREDIT_CAP[p]).toBeGreaterThan(0);
      expect(DAILY_COST_CAP_MICROS[p]).toBeGreaterThan(0);
    }
  });
  it("never lets the daily cap exceed the plan's credits", () => {
    for (const p of PLANS) {
      expect(DAILY_CREDIT_CAP[p]).toBeLessThanOrEqual(PLAN_CREDITS[p]);
    }
  });
});
