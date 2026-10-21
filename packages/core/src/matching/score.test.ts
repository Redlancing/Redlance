import { describe, expect, it } from "vitest";
import { warningFlags } from "../job-post";
import { BROAD_CAP } from "./constants";
import {
  budgetFit,
  isCandidate,
  passesFilters,
  ruleScore,
  WEIGHTS,
  type MatchPost,
  type MatchProfile,
} from "./score";

// "stripe" is not a taxonomy id (it's an alias of "payments"), so Priya uses "payments".
const priya: MatchProfile = {
  categories: ["development"],
  skills: [
    { id: "nextjs", level: "core" },
    { id: "react", level: "core" },
    { id: "payments", level: "core" },
    { id: "postgresql", level: "secondary" },
  ],
  workSkillIds: ["nextjs", "payments"],
  minRateMinor: 3000,
  currency: "USD",
  rateType: "either",
  remoteOnly: true,
  includeUnpaid: false,
};

const now = new Date("2026-10-17T12:00:00Z");

const base: MatchPost = {
  postedAt: new Date("2026-10-16T12:00:00Z"),
  kind: "hiring",
  employmentType: "freelance",
  payType: "paid",
  categories: ["development"],
  skillIds: [],
  budgetMin: null,
  budgetMax: null,
  currency: null,
  budgetUnit: null,
  remote: "unknown",
  deadline: null,
  redFlags: [],
};
const mk = (o: Partial<MatchPost>): MatchPost => ({ ...base, ...o });
const mp = (o: Partial<MatchProfile>): MatchProfile => ({ ...priya, ...o });

const postA = mk({
  skillIds: ["nextjs", "payments"],
  budgetMin: 400,
  budgetMax: 400,
  currency: "USD",
  budgetUnit: "fixed",
  remote: "remote",
});

describe("ruleScore", () => {
  it("1: post A scores 80", () => {
    expect(isCandidate(postA, priya)).toBe("skill");
    const r = ruleScore(postA, priya);
    expect(r.score).toBe(80);
    expect(r.broad).toBe(false);
    expect(r.reason).toContain("Next.js");
    expect(r.reason).toContain("Payments integration");
  });
  it("2: post B clamps to 0", () => {
    const b = mk({
      skillIds: ["postgresql"],
      budgetMax: 25,
      currency: "USD",
      budgetUnit: "hour",
    });
    expect(ruleScore(b, priya).score).toBe(0);
  });
  it("3: post C is broad and scores 20", () => {
    const c = mk({ categories: ["design", "development"], remote: "remote" });
    expect(isCandidate(c, priya)).toBe("broad");
    const r = ruleScore(c, priya);
    expect(r.score).toBe(20);
    expect(r.broad).toBe(true);
    expect(r.reason).toContain("Broad match");
  });
  it("4: video post is not a candidate", () => {
    const d = mk({ categories: ["video"], skillIds: ["video-editing"] });
    expect(isCandidate(d, priya)).toBeNull();
  });
  it("5: core part caps at 60", () => {
    const p = mp({
      skills: ["nextjs", "react", "payments", "vue"].map((id) => ({
        id,
        level: "core" as const,
      })),
      categories: [],
      workSkillIds: [],
      remoteOnly: false,
    });
    const r = ruleScore(
      mk({ categories: [], skillIds: ["nextjs", "react", "payments", "vue"] }),
      p,
    );
    expect(r.features.find((f) => f.signal === "core_skill")!.points).toBe(60);
    expect(r.score).toBe(60);
  });
  it("6: secondary part caps at 24", () => {
    const p = mp({
      skills: ["nextjs", "react", "payments", "vue"].map((id) => ({
        id,
        level: "secondary" as const,
      })),
      categories: [],
      workSkillIds: [],
    });
    const r = ruleScore(
      mk({ categories: [], skillIds: ["nextjs", "react", "payments", "vue"] }),
      p,
    );
    expect(r.features.find((f) => f.signal === "secondary_skill")!.points).toBe(
      24,
    );
  });
  it("7: everything maxed clamps to 100", () => {
    const p = mp({
      skills: [
        { id: "nextjs", level: "core" },
        { id: "react", level: "core" },
        { id: "payments", level: "core" },
        { id: "vue", level: "secondary" },
        { id: "tailwind", level: "secondary" },
        { id: "postgresql", level: "secondary" },
      ],
    });
    const post = mk({
      skillIds: [
        "nextjs",
        "react",
        "payments",
        "vue",
        "tailwind",
        "postgresql",
      ],
      budgetMax: 400,
      currency: "USD",
      budgetUnit: "fixed",
      remote: "remote",
    });
    expect(ruleScore(post, p).score).toBe(100);
  });
  it("8: two red flags cost 30", () => {
    const r = ruleScore(
      mk({ ...postA, redFlags: ["upfront_fee", "asks_for_free_work"] }),
      priya,
    );
    expect(r.score).toBe(50);
    expect(r.reason).toContain("red flag");
  });
  it("8b: vague_pay (no budget stated) costs nothing", () => {
    const base = ruleScore(mk(postA), priya);
    const r = ruleScore(mk({ ...postA, redFlags: ["vague_pay"] }), priya);
    expect(r.score).toBe(base.score);
    expect(r.features.some((f) => f.signal === "red_flag")).toBe(false);
    const both = ruleScore(
      mk({ ...postA, redFlags: ["vague_pay", "upfront_fee"] }),
      priya,
    );
    expect(both.score).toBe(base.score - 15);
  });
  it("8c: old stored adult_content/unrealistic_pay/academic_dishonesty cost nothing", () => {
    const base = ruleScore(mk(postA), priya);
    const old = ["adult_content", "unrealistic_pay", "academic_dishonesty"];
    expect(warningFlags(old)).toEqual([]);
    const r = ruleScore(mk({ ...postA, redFlags: old }), priya);
    expect(r.score).toBe(base.score);
    expect(r.features.some((f) => f.signal === "red_flag")).toBe(false);
  });
  it("9: broad with a red flag is 5", () => {
    const c = mk({
      categories: ["development"],
      remote: "remote",
      redFlags: ["upfront_fee"],
    });
    expect(ruleScore(c, priya).score).toBe(5);
  });
  it("10: broad never exceeds BROAD_CAP even with big weights", () => {
    const c = mk({
      categories: ["development"],
      remote: "remote",
      budgetMax: 400,
      currency: "USD",
      budgetUnit: "fixed",
    });
    const r = ruleScore(c, priya, { ...WEIGHTS, jobType: 90, budgetFits: 90 });
    expect(r.score).toBe(BROAD_CAP);
  });
  it("lists only non-zero signals in table order", () => {
    const r = ruleScore(postA, priya);
    expect(r.features.map((f) => f.signal)).toEqual([
      "core_skill",
      "job_type",
      "budget_fits",
      "work_overlap",
      "remote_fit",
    ]);
  });
  it("30: is deterministic", () => {
    expect(ruleScore(postA, priya)).toEqual(ruleScore(postA, priya));
  });
});

describe("budgetFit", () => {
  const hourly = (amt: number, extra: Partial<MatchPost> = {}) =>
    mk({ budgetMax: amt, currency: "USD", budgetUnit: "hour", ...extra });
  it("11: $40/hour fits a $30 minimum", () => {
    expect(budgetFit(hourly(40), priya)).toBe("fits");
  });
  it("12: $200/day is below (240 needed)", () => {
    expect(budgetFit(hourly(200, { budgetUnit: "day" }), priya)).toBe("below");
  });
  it("13: fixed vs an hourly-only user is unknown", () => {
    expect(
      budgetFit(
        mk({ budgetMax: 400, currency: "USD", budgetUnit: "fixed" }),
        mp({ rateType: "hourly" }),
      ),
    ).toBe("unknown");
  });
  it("14: hour vs a fixed-only user is unknown", () => {
    expect(budgetFit(hourly(40), mp({ rateType: "fixed" }))).toBe("unknown");
  });
  it("15: week, month, per_item are unknown", () => {
    for (const budgetUnit of ["week", "month", "per_item"] as const) {
      expect(budgetFit(hourly(9999, { budgetUnit }), priya)).toBe("unknown");
    }
  });
  it("16: missing currency or amounts are unknown", () => {
    expect(budgetFit(hourly(40, { currency: null }), priya)).toBe("unknown");
    expect(budgetFit(mk({ currency: "USD", budgetUnit: "hour" }), priya)).toBe(
      "unknown",
    );
    expect(budgetFit(hourly(40, { currency: "XYZ" }), priya)).toBe("unknown");
  });
  it("17: INR 2000/hour is below $30/hour", () => {
    expect(budgetFit(hourly(2000, { currency: "INR" }), priya)).toBe("below");
  });
  it("18: uses the max of a range", () => {
    expect(budgetFit(hourly(50, { budgetMin: 20 }), priya)).toBe("fits");
  });
  it("19: a zero minimum fits any known amount", () => {
    expect(budgetFit(hourly(1), mp({ minRateMinor: 0 }))).toBe("fits");
  });
  it("rounds the converted amount to cents ($33 is exactly EUR 30 at 1.1)", () => {
    const eur = mp({ currency: "EUR", minRateMinor: 3000, rateType: "hourly" });
    expect(budgetFit(hourly(33), eur)).toBe("fits");
    expect(
      budgetFit(
        hourly(55),
        mp({ currency: "EUR", minRateMinor: 5000, rateType: "hourly" }),
      ),
    ).toBe("fits");
  });
  it("a reversed range (min above max) uses the higher figure", () => {
    expect(budgetFit(hourly(20, { budgetMin: 50 }), priya)).toBe("fits");
  });
});

describe("passesFilters", () => {
  const ok = (p: Partial<MatchPost>, prof: Partial<MatchProfile> = {}) =>
    passesFilters(mk(p), mp(prof), now);
  it("baseline passes", () => {
    expect(ok({})).toBe(true);
  });
  it("20: for_hire and other fail", () => {
    expect(ok({ kind: "for_hire" })).toBe(false);
    expect(ok({ kind: "other" })).toBe(false);
  });
  it("21: full_time fails; contract and part_time pass", () => {
    expect(ok({ employmentType: "full_time" })).toBe(false);
    expect(ok({ employmentType: "contract" })).toBe(true);
    expect(ok({ employmentType: "part_time" })).toBe(true);
  });
  it("22: 8 days old fails, 6 passes", () => {
    expect(ok({ postedAt: new Date(now.getTime() - 8 * 86_400_000) })).toBe(
      false,
    );
    expect(ok({ postedAt: new Date(now.getTime() - 6 * 86_400_000) })).toBe(
      true,
    );
  });
  it("23: deadlines", () => {
    expect(ok({ deadline: "2026-10-16" })).toBe(false);
    expect(ok({ deadline: "2026-10-17" })).toBe(true);
    expect(ok({ deadline: null })).toBe(true);
  });
  it("24: remote-only user vs onsite", () => {
    expect(ok({ remote: "onsite" })).toBe(false);
    expect(ok({ remote: "hybrid" })).toBe(true);
    expect(ok({ remote: "unknown" })).toBe(true);
    expect(ok({ remote: "onsite" }, { remoteOnly: false })).toBe(true);
  });
  it("25: unpaid kinds need includeUnpaid", () => {
    for (const payType of ["unpaid", "commission_only", "revshare"] as const) {
      expect(ok({ payType })).toBe(false);
      expect(ok({ payType }, { includeUnpaid: true })).toBe(true);
    }
    expect(ok({ payType: "unknown" })).toBe(true);
  });
});
