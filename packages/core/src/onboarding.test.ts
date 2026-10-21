import { describe, expect, it } from "vitest";
import {
  PAGE_IDS,
  PAGE_TITLES,
  STEP_IDS,
  STEP_SCHEMAS,
  canOpen,
  emptyDraft,
  isValidTimeZone,
  nextPage,
  checkGithubInput,
  parseGithubUsername,
  resumeAt,
  toFieldErrors,
} from "./onboarding";
import { SKILLS } from "./taxonomy";

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
        ["import", "basics", "skills", "work", "rates"].map((step) => ({
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

  it("STEP_IDS are import, basics, skills, work, rates", () => {
    expect(STEP_IDS).toEqual(["import", "basics", "skills", "work", "rates"]);
    expect(PAGE_TITLES.work).toBe("Projects & experience");
  });

  it("PAGE_IDS end with review and have 6 entries", () => {
    expect(PAGE_IDS).toHaveLength(6);
    expect(PAGE_IDS.at(-1)).toBe("review");
  });

  it("puts work between skills and rates", () => {
    expect(nextPage("skills")).toBe("work");
    expect(nextPage("work")).toBe("rates");
  });

  it("resumeAt returns work when skills is the last completed step", () => {
    expect(
      resumeAt(
        ["import", "basics", "skills"].map((step) => ({
          step,
          status: "completed" as const,
        })),
      ),
    ).toBe("work");
  });

  it("registers the work step's schemas", () => {
    expect(emptyDraft("work")).toEqual({
      projects: [],
      experience: [],
      mentionEmployers: false,
    });
    expect(
      STEP_SCHEMAS.work.complete.safeParse({ projects: [{ title: "" }] })
        .success,
    ).toBe(false);
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
    const data = { skills: [skill("react", "secondary")] };
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
    const thirtyOne = {
      skills: SKILLS.slice(0, 31).map((s) => skill(s.id, "secondary")),
    };
    const over = STEP_SCHEMAS.skills.draft.safeParse(thirtyOne);
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.message).toBe("Keep it to 30 skills.");
  });

  it("drops a customSkills key from rows saved before custom skills were removed", () => {
    const legacy = {
      skills: [skill("react")],
      customSkills: [
        { name: "Descript", level: "secondary", source: "manual" },
      ],
    };
    for (const schema of [
      STEP_SCHEMAS.skills.draft,
      STEP_SCHEMAS.skills.complete,
    ]) {
      const parsed = schema.parse(legacy);
      expect(parsed).toEqual({
        skills: [{ id: "react", level: "core", source: "manual" }],
      });
      expect("customSkills" in parsed).toBe(false);
    }
  });

  it("still refuses other unknown keys", () => {
    expect(
      STEP_SCHEMAS.skills.draft.safeParse({ skills: [], extra: 1 }).success,
    ).toBe(false);
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

describe("checkGithubInput", () => {
  const ok = (input: string) => checkGithubInput(input);
  const reason = (input: string) => {
    const r = checkGithubInput(input);
    return r.ok ? null : r.reason;
  };

  it("treats an empty field as fine (GitHub is optional)", () => {
    expect(ok("")).toEqual({ ok: true, username: null });
    expect(ok("   ")).toEqual({ ok: true, username: null });
  });

  it("accepts profile and repo links on github.com, with or without scheme or www", () => {
    for (const input of [
      "octocat",
      "@octocat",
      "github.com/octocat",
      "GitHub.com/octocat/",
      "http://github.com/octocat",
      "https://www.github.com/octocat/hello-world?tab=readme#top",
    ])
      expect(ok(input)).toEqual({ ok: true, username: "octocat" });
  });

  it("says when a link isn't on GitHub, including look-alike hosts", () => {
    for (const input of [
      "https://gitlab.com/octocat",
      "linkedin.com/in/octocat",
      "https://github.com.evil.example/octocat",
      "https://evil.example/github.com/octocat",
      "https://github.com@evil.example/octocat",
      "https://gist.github.com/octocat",
      "https://raw.githubusercontent.com/octocat/x/main/a.sh",
      "javascript:alert(1)",
      "ftp://github.com/octocat",
      "https://github.com:8443/octocat",
      "https://user:pass@github.com/octocat",
    ])
      expect(reason(input), input).toBe("not_github");
  });

  it("says when a GitHub link isn't a profile", () => {
    expect(reason("https://github.com")).toBe("no_username");
    expect(reason("github.com/")).toBe("no_username");
    for (const page of [
      "settings",
      "orgs",
      "explore",
      "Topics",
      "marketplace",
      "login",
    ])
      expect(reason(`https://github.com/${page}`), page).toBe("not_a_profile");
  });

  it("says when the username itself is invalid", () => {
    for (const input of [
      "-octocat",
      "octo--cat",
      "a".repeat(40),
      "octo cat",
      "octo_cat",
      "<script>",
    ])
      expect(reason(input), input).toBe("invalid_username");
    expect(ok("a".repeat(39))).toEqual({ ok: true, username: "a".repeat(39) });
  });

  it("gives every failure a message", () => {
    const r = checkGithubInput("https://gitlab.com/octocat");
    expect(!r.ok && r.message).toMatch(/GitHub/);
  });

  it("the import schema refuses reserved GitHub pages as usernames", () => {
    expect(
      STEP_SCHEMAS.import.complete.safeParse({ githubUsername: "settings" })
        .success,
    ).toBe(false);
    expect(
      STEP_SCHEMAS.import.complete.safeParse({ githubUsername: "octocat" })
        .success,
    ).toBe(true);
  });
});

describe("rates", () => {
  const rates = {
    minRate: 25,
    currency: "USD",
    rateType: "hourly",
    remoteOnly: true,
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

  it("still parses rows saved with the removed blockedWords key", () => {
    const old = { ...rates, blockedWords: ["unpaid"] };
    expect(STEP_SCHEMAS.rates.complete.parse(old)).toEqual(rates);
    expect(
      STEP_SCHEMAS.rates.draft.parse({ minRate: 10, blockedWords: [] }),
    ).toEqual({
      minRate: 10,
      currency: null,
      rateType: null,
      remoteOnly: false,
    });
  });

  it("still refuses other unknown keys", () => {
    expect(
      STEP_SCHEMAS.rates.complete.safeParse({ ...rates, extra: 1 }).success,
    ).toBe(false);
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
      remoteOnly: "yes",
    });
    const errors = toFieldErrors(result.error!, "data");
    expect(errors.map((e) => e.path)).toEqual(
      expect.arrayContaining(["data.minRate", "data.remoteOnly"]),
    );
  });
});
