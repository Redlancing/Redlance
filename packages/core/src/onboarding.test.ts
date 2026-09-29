import { describe, expect, it } from "vitest";
import {
  STEP_SCHEMAS,
  canOpen,
  emptyDraft,
  isUsableSkillName,
  isValidTimeZone,
  nextPage,
  parseGithubUsername,
  resumeAt,
  toFieldErrors,
} from "./onboarding";

const basics = {
  displayName: "Asha",
  headline: "Video editor for YouTubers",
  categories: ["video"],
  experienceLevel: "intermediate",
  country: "IN",
  timeZone: "Asia/Kolkata",
};

describe("resumeAt / page helpers", () => {
  it("starts at import, skips completed steps, stops at the first draft", () => {
    expect(resumeAt([])).toBe("import");
    expect(
      resumeAt([
        { step: "import", status: "completed" },
        { step: "basics", status: "draft" },
      ]),
    ).toBe("basics");
    expect(
      resumeAt(
        ["import", "basics", "skills", "rates"].map((step) => ({
          step,
          status: "completed" as const,
        })),
      ),
    ).toBe("review");
  });

  it("lets users open earlier pages but not later ones", () => {
    expect(canOpen("import", "skills")).toBe(true);
    expect(canOpen("skills", "skills")).toBe(true);
    expect(canOpen("rates", "skills")).toBe(false);
    expect(nextPage("rates")).toBe("review");
  });
});

describe("basics", () => {
  it("accepts a complete step and trims text", () => {
    const parsed = STEP_SCHEMAS.basics.complete.parse({
      ...basics,
      displayName: "  Asha ",
    });
    expect(parsed.displayName).toBe("Asha");
  });

  it("lets a draft be empty, but not over the limits", () => {
    expect(STEP_SCHEMAS.basics.draft.parse({})).toEqual(emptyDraft("basics"));
    expect(
      STEP_SCHEMAS.basics.draft.safeParse({ displayName: "x".repeat(61) })
        .success,
    ).toBe(false);
  });

  it("requires the fields with friendly messages", () => {
    const result = STEP_SCHEMAS.basics.complete.safeParse(emptyDraft("basics"));
    expect(result.success).toBe(false);
    const paths = toFieldErrors(result.error!).map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "displayName",
        "categories",
        "experienceLevel",
        "country",
        "timeZone",
      ]),
    );
  });

  it("rejects unknown keys, unknown categories, duplicates, >3 job types, bad countries and zones", () => {
    const bad = (patch: object) =>
      STEP_SCHEMAS.basics.complete.safeParse({ ...basics, ...patch }).success;
    expect(bad({ extra: 1 })).toBe(false);
    expect(bad({ categories: ["knitting"] })).toBe(false);
    expect(bad({ categories: ["video", "video"] })).toBe(false);
    expect(bad({ categories: ["video", "design", "art", "audio"] })).toBe(
      false,
    );
    expect(bad({ country: "XX" })).toBe(false);
    expect(bad({ timeZone: "Mars/Olympus" })).toBe(false);
  });

  it("accepts legacy time zone aliases that browsers still report", () => {
    expect(isValidTimeZone("Asia/Calcutta")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("+05:30")).toBe(false);
  });
});

describe("skills", () => {
  const skill = (id: string, level = "core") => ({ id, level });

  it("needs at least one core skill to complete, not to draft", () => {
    const data = { skills: [skill("react", "secondary")], customSkills: [] };
    expect(STEP_SCHEMAS.skills.draft.safeParse(data).success).toBe(true);
    expect(STEP_SCHEMAS.skills.complete.safeParse(data).success).toBe(false);
  });

  it("defaults source to manual", () => {
    const parsed = STEP_SCHEMAS.skills.complete.parse({
      skills: [skill("react")],
    });
    expect(parsed.skills[0]!.source).toBe("manual");
  });

  it("caps core at 8 and total at 30, refuses unknown ids and duplicates, even in drafts", () => {
    const ids = [
      "react",
      "nextjs",
      "nodejs",
      "python",
      "django",
      "vue",
      "svelte",
      "php",
      "laravel",
    ];
    const tooManyCore = { skills: ids.map((id) => skill(id)) };
    expect(STEP_SCHEMAS.skills.draft.safeParse(tooManyCore).success).toBe(
      false,
    );
    expect(
      STEP_SCHEMAS.skills.draft.safeParse({ skills: [skill("nope")] }).success,
    ).toBe(false);
    expect(
      STEP_SCHEMAS.skills.draft.safeParse({
        skills: [skill("react"), skill("react")],
      }).success,
    ).toBe(false);
    expect(
      STEP_SCHEMAS.skills.draft.safeParse({
        customSkills: [
          { name: "Three.js", level: "secondary" },
          { name: " three.JS ", level: "secondary" },
        ],
      }).success,
    ).toBe(false);
    const thirtyOne = {
      skills: [skill("react")],
      customSkills: Array.from({ length: 30 }, (_, i) => ({
        name: `Tool ${i}`,
        level: "secondary",
      })),
    };
    expect(STEP_SCHEMAS.skills.draft.safeParse(thirtyOne).success).toBe(false);
  });

  it("rejects custom skill names without a letter or digit", () => {
    const invisible = STEP_SCHEMAS.skills.draft.safeParse({
      customSkills: [{ name: "\u200b", level: "secondary" }],
    });
    expect(invisible.success).toBe(false);
    expect(invisible.error?.issues[0]?.message).toBe("Use letters or numbers.");
    expect(
      STEP_SCHEMAS.skills.draft.safeParse({
        customSkills: [{ name: "--", level: "secondary" }],
      }).success,
    ).toBe(false);
    expect(
      STEP_SCHEMAS.skills.draft.safeParse({
        customSkills: [{ name: "C#", level: "secondary" }],
      }).success,
    ).toBe(true);
    expect(isUsableSkillName("\u200b")).toBe(false);
    expect(isUsableSkillName(" Figma ")).toBe(true);
    expect(isUsableSkillName("日本語")).toBe(true);
  });
});

describe("GitHub link", () => {
  it("accepts a username or a github.com URL and keeps just the username", () => {
    expect(parseGithubUsername("octocat")).toBe("octocat");
    expect(parseGithubUsername(" @octocat ")).toBe("octocat");
    expect(parseGithubUsername("github.com/octocat")).toBe("octocat");
    expect(
      parseGithubUsername(
        "https://www.github.com/octo-cat/some-repo?tab=repositories",
      ),
    ).toBe("octo-cat");
    expect(parseGithubUsername("   ")).toBeNull();
  });

  it("refuses things that can't be a GitHub username", () => {
    expect(parseGithubUsername("-octocat")).toBeNull();
    expect(parseGithubUsername("octo--cat")).toBeNull();
    expect(parseGithubUsername("a".repeat(40))).toBeNull();
    expect(parseGithubUsername("https://gitlab.com/octocat")).toBeNull();
    expect(parseGithubUsername("octo cat")).toBeNull();
  });
});

describe("rates", () => {
  const rates = {
    minRate: 25,
    currency: "USD",
    rateType: "hourly",
    remoteOnly: true,
    blockedWords: ["unpaid"],
  };

  it("accepts a complete step", () => {
    expect(STEP_SCHEMAS.rates.complete.parse(rates)).toEqual(rates);
  });

  it("allows 0 (any budget) but refuses negatives, >100000, 3 decimals, NaN", () => {
    const ok = (minRate: unknown) =>
      STEP_SCHEMAS.rates.complete.safeParse({ ...rates, minRate }).success;
    expect(ok(0)).toBe(true);
    expect(ok(12.5)).toBe(true);
    expect(ok(-1)).toBe(false);
    expect(ok(100_001)).toBe(false);
    expect(ok(1.005)).toBe(false);
    expect(ok(Number.NaN)).toBe(false);
    expect(ok("25")).toBe(false);
  });

  it("refuses duplicate blocked words ignoring case, and more than 50", () => {
    const words = (blockedWords: string[]) =>
      STEP_SCHEMAS.rates.draft.safeParse({ blockedWords }).success;
    expect(words(["Unpaid", "unpaid"])).toBe(false);
    expect(words(Array.from({ length: 51 }, (_, i) => `w${i}`))).toBe(false);
  });
});

describe("import", () => {
  it("stores an optional GitHub username, and only a bare username", () => {
    expect(STEP_SCHEMAS.import.complete.parse({})).toEqual({
      githubUsername: null,
    });
    expect(
      STEP_SCHEMAS.import.complete.parse({ githubUsername: "octocat" }),
    ).toEqual({ githubUsername: "octocat" });
    expect(
      STEP_SCHEMAS.import.complete.safeParse({
        githubUsername: "github.com/octocat",
      }).success,
    ).toBe(false);
    expect(
      STEP_SCHEMAS.import.complete.safeParse({
        githubUsername: null,
        file: "x",
      }).success,
    ).toBe(false);
  });
});

describe("toFieldErrors", () => {
  it("joins paths and adds a prefix", () => {
    const result = STEP_SCHEMAS.rates.complete.safeParse({
      minRate: -1,
      currency: "USD",
      rateType: "fixed",
      blockedWords: ["a", "A"],
    });
    const errors = toFieldErrors(result.error!, "data");
    expect(errors.map((e) => e.path)).toEqual(
      expect.arrayContaining(["data.minRate", "data.blockedWords.1"]),
    );
  });
});
