import { describe, expect, it } from "vitest";
import {
  findNumbers,
  findUrls,
  formatProblemsForRetry,
  lengthTarget,
  maskNumbers,
  validateDraft,
  type DraftTexts,
  type ValidateContext,
} from "./validate";
import type { Evidence, VoiceStats } from "./types";

const evidence = (over: Partial<Evidence> = {}): Evidence => ({
  project: null,
  role: null,
  skills: [],
  allowedLinks: ["https://github.com/me/shop"],
  rateNote: { mention: false },
  availability: null,
  redFlags: [],
  broad: false,
  employerNamesAllowed: false,
  organisationNames: [],
  evidenceText: "",
  summary: { projectTitle: null, roleTitle: null, skills: [] },
  citedProjectIds: [],
  ...over,
});

const ctx = (over: Partial<ValidateContext> = {}): ValidateContext => ({
  postText: "Need a developer to speed up our shop.",
  target: lengthTarget(),
  ...over,
});

const words = (n: number) =>
  Array.from({ length: n }, () => "word").join(" ") + ".";
const codes = (p: { code: string }[]) => p.map((x) => x.code);
const run = (d: Partial<DraftTexts>, e = evidence(), c = ctx()) =>
  validateDraft({ comment: "Happy to help.", dm: words(90), ...d }, e, c);

const stats = (n: number, avgWords: number): VoiceStats => ({
  n,
  avgWords,
  avgWordsPerSentence: 10,
  greetingRate: 0,
  signOffRate: 0,
  emojiRate: 0,
  avgExclamations: 0,
  lowercaseStartRate: 0,
  linkRate: 0,
  avgLinkPosition: 0,
  mentionsRateRate: 0,
  avgEditRatio: 0,
});

describe("validateDraft", () => {
  it("1: a clean draft has no problems", () => {
    expect(
      run({ comment: "I fixed a slow shop before. Happy to share." }),
    ).toEqual([]);
  });

  it("2: long comments", () => {
    expect(codes(run({ comment: "One. Two. Three. Four." }))).toEqual([
      "COMMENT_TOO_LONG",
    ]);
    expect(codes(run({ comment: "a".repeat(320) + "." }))).toEqual([
      "COMMENT_TOO_LONG",
    ]);
  });

  it("3: DM length with the default target", () => {
    expect(codes(run({ dm: words(40) }))).toEqual(["DM_TOO_SHORT"]);
    expect(codes(run({ dm: words(170) }))).toEqual(["DM_TOO_LONG"]);
  });

  it("4: voice stats set the target", () => {
    const c = ctx({ target: lengthTarget(stats(5, 40)) });
    expect(c.target).toEqual({ dmMin: 40, dmMax: 60 });
    expect(codes(run({ dm: words(70) }, evidence(), c))).toEqual([
      "DM_TOO_LONG",
    ]);
  });

  it("5: fewer than 3 sends uses the default", () => {
    expect(lengthTarget(stats(2, 40))).toEqual({ dmMin: 60, dmMax: 150 });
    expect(lengthTarget()).toEqual({ dmMin: 60, dmMax: 150 });
    expect(lengthTarget(stats(10, 300))).toEqual({ dmMin: 150, dmMax: 180 });
  });

  it("6: banned phrases", () => {
    const p = run({ dm: "Dear Sir, I came across your post. " + words(80) });
    expect(codes(p)).toEqual(["BANNED_PHRASE", "BANNED_PHRASE"]);
    expect(p.map((x) => x.detail)).toEqual([
      "i came across your post",
      "dear sir",
    ]);
  });

  it("7: banned phrases respect word boundaries", () => {
    expect(run({ dm: "It was unkindly said. " + words(80) })).toEqual([]);
  });

  it("8: the allowed link passes with a trailing slash or case change", () => {
    expect(run({ dm: "See https://GitHub.com/me/shop/ " + words(80) })).toEqual(
      [],
    );
  });

  it("9: a second link", () => {
    const p = run({
      dm:
        "See https://github.com/me/shop and https://example.com/x " + words(80),
    });
    expect(codes(p)).toEqual(["UNKNOWN_LINK"]);
    expect(p[0]!.detail).toBe("https://example.com/x");
  });

  it("10: a bare github link that isn't allowed", () => {
    expect(
      codes(run({ dm: "More at github.com/someone-else " + words(80) })),
    ).toEqual(["UNKNOWN_LINK"]);
  });

  it("11: a number backed by the evidence", () => {
    const e = evidence({ evidenceText: "Cut load time by 40% on a shop." });
    expect(run({ comment: "I cut load time by 40% before." }, e)).toEqual([]);
  });

  it("12: an invented number", () => {
    const p = run({ comment: "I cut load time by 60% before." });
    expect(p).toEqual([{ code: "UNSUPPORTED_NUMBER", detail: "60%" }]);
  });

  it("13: money is normalised", () => {
    const c = ctx({ postText: "Budget is $2,000." });
    expect(run({ comment: "Fine at $2k." }, evidence(), c)).toEqual([]);
  });

  it("14: years of experience are claims", () => {
    expect(codes(run({ comment: "I have 5 years of it." }))).toEqual([
      "UNSUPPORTED_NUMBER",
    ]);
  });

  it("14b: plain small counts are fine", () => {
    expect(run({ comment: "I have 2 quick questions." })).toEqual([]);
    expect(run({ dm: "Can be done in 1 week. " + words(80) })).toEqual([]);
  });

  it("14c: multipliers, client counts and percentages are claims", () => {
    const p = run({
      comment: "3x faster.",
      dm: "Worked with 8 clients, 40% fewer bugs. " + words(80),
    });
    expect(codes(p)).toEqual([
      "UNSUPPORTED_NUMBER",
      "UNSUPPORTED_NUMBER",
      "UNSUPPORTED_NUMBER",
    ]);
  });

  it("15: a number from the instruction", () => {
    const c = ctx({ instruction: "say I can start in 3 days" });
    expect(
      run({ dm: "I can start in 30 days. " + words(80) }, evidence(), c),
    ).toHaveLength(1);
    expect(
      run({ dm: "I can start in 3 days. " + words(80) }, evidence(), c),
    ).toEqual([]);
    const c2 = ctx({ instruction: "start in 14 days" });
    expect(
      run({ dm: "I can start in 14 days. " + words(80) }, evidence(), c2),
    ).toEqual([]);
  });

  it("numbers inside allowed links are ignored", () => {
    const e = evidence({ allowedLinks: ["https://github.com/me/shop2024"] });
    expect(
      run({ dm: "See https://github.com/me/shop2024 " + words(80) }, e),
    ).toEqual([]);
  });

  it("16: an employer name when employers are off", () => {
    const e = evidence({ organisationNames: ["Acme Realty"] });
    const p = run({ dm: "At Acme Realty I did this. " + words(80) }, e);
    expect(p).toEqual([{ code: "ORGANISATION_NAME", detail: "Acme Realty" }]);
  });

  it("17: ... and when employers are on", () => {
    const e = evidence({
      organisationNames: ["Acme Realty"],
      employerNamesAllowed: true,
    });
    expect(run({ dm: "At Acme Realty I did this. " + words(80) }, e)).toEqual(
      [],
    );
  });

  it("18: an empty comment is fine", () => {
    expect(run({ comment: "" })).toEqual([]);
  });

  it("19: both empty", () => {
    expect(validateDraft({ comment: " ", dm: "" }, evidence(), ctx())).toEqual([
      { code: "EMPTY" },
    ]);
  });
});

describe("formatProblemsForRetry", () => {
  it("20: one line per problem, with the detail", () => {
    const out = formatProblemsForRetry([
      { code: "UNSUPPORTED_NUMBER", detail: "60%" },
      { code: "BANNED_PHRASE", detail: "kindly" },
      { code: "DM_TOO_SHORT" },
    ]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("60%");
    expect(lines[1]).toContain("kindly");
  });
});

describe("findNumbers / findUrls", () => {
  it("21: normalises numbers", () => {
    expect(findNumbers("₹1,500/hr, 2.5k, 2025, 30%")).toEqual([
      1500, 2500, 2025, 30,
    ]);
    expect(findNumbers("$1,500 and £40/hr and 2k")).toEqual([1500, 40, 2000]);
  });

  it("finds urls", () => {
    expect(findUrls("see https://a.com/x, and github.com/me/y.")).toEqual([
      "https://a.com/x",
      "github.com/me/y",
    ]);
  });
});

describe("M5: bare domains are links", () => {
  it("doesn't treat tool names that look like domains as links", () => {
    expect(findUrls("I built it in ASP.NET, Socket.io and Make.com.")).toEqual([]);
    expect(findUrls("see make.com/scenario")).toEqual(["make.com/scenario"]);
  });

  it("finds bare domains, paths and www hosts", () => {
    expect(
      findUrls(
        "evil.com/pay t.me/scammer calendly.com/x https://ok.dev/a www.thing.org",
      ),
    ).toEqual([
      "evil.com/pay",
      "t.me/scammer",
      "calendly.com/x",
      "https://ok.dev/a",
      "www.thing.org",
    ]);
    expect(findUrls("Pay at example.com.")).toEqual(["example.com"]);
  });
  it.each([
    "t.me/x",
    "evil.com/pay",
    "calendly.com/x",
    "book at myshop.io",
    "see EVIL.COM",
  ])("flags %s", (bit) => {
    expect(codes(run({ dm: `${bit} ${words(80)}` }))).toEqual(["UNKNOWN_LINK"]);
  });
  it.each([
    "I used Next.js and Node.js, e.g. for the API.",
    "Upgraded to v2.0 and renamed file.ts and README.md.",
    "It went well.So I kept going, i.e. quickly. Then Sent.To them.",
    "Works with me@example and later.",
  ])("does not flag %s", (bit) => {
    expect(run({ dm: `${bit} ${words(80)}` })).toEqual([]);
  });
  it("the allowed link written bare passes", () => {
    expect(run({ dm: `See github.com/me/shop ${words(80)}` })).toEqual([]);
    expect(run({ dm: `See www.github.com/me/shop ${words(80)}` })).toEqual([]);
  });
});

describe("maskNumbers", () => {
  it("masks only claim-like backed numbers", () => {
    const backed = (v: number) => v === 40 || v === 1500;
    expect(
      maskNumbers(
        "Cut 40% for 2 clients, $1,500 and 60%, 5 pages",
        backed,
        "{number}",
      ),
    ).toBe("Cut {number} for 2 clients, {number} and 60%, 5 pages");
  });
});
