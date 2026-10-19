import { describe, expect, it } from "vitest";
import { ruleReason } from "./reason";

describe("ruleReason", () => {
  it("names skills, not ids", () => {
    const r = ruleReason([
      { signal: "core_skill", points: 40, detail: ["nextjs", "payments"] },
      { signal: "budget_fits", points: 10 },
      { signal: "remote_fit", points: 5 },
    ]);
    expect(r).toBe(
      "2 of your core skills (Next.js, Payments integration) · budget fits · remote",
    );
    expect(r).not.toContain("nextjs");
  });
  it("shows at most 3 names then +N", () => {
    const r = ruleReason([
      {
        signal: "core_skill",
        points: 60,
        detail: ["nextjs", "react", "payments", "postgresql", "vue"],
      },
    ]);
    expect(r).toContain("+2");
    expect(r).toContain("Next.js, React, Payments integration +2");
    expect(r).not.toContain("PostgreSQL");
  });
  it("uses broad wording", () => {
    const r = ruleReason(
      [
        { signal: "job_type", points: 15, detail: ["development"] },
        { signal: "budget_below", points: -25 },
      ],
      undefined,
      true,
    );
    expect(r).toBe(
      "Broad match: shares your job type · budget below your minimum",
    );
  });
  it("words red flags", () => {
    const r = ruleReason([
      { signal: "secondary_skill", points: 8, detail: ["postgresql"] },
      { signal: "red_flag", points: -15, detail: ["upfront_fee"] },
    ]);
    expect(r).toBe("1 secondary skill (PostgreSQL) · red flag: upfront fee");
  });
  it("stays within 120 characters", () => {
    const r = ruleReason([
      {
        signal: "core_skill",
        points: 60,
        detail: ["nextjs", "react", "payments"],
      },
      {
        signal: "secondary_skill",
        points: 24,
        detail: ["postgresql", "vue", "tailwind"],
      },
      { signal: "job_type", points: 15, detail: ["development"] },
      { signal: "budget_fits", points: 10 },
      { signal: "work_overlap", points: 10, detail: ["nextjs"] },
      { signal: "remote_fit", points: 5 },
      {
        signal: "red_flag",
        points: -45,
        detail: ["upfront_fee", "vague_pay", "asks_for_free_work"],
      },
    ]);
    expect(r.length).toBeLessThanOrEqual(120);
  });
});
