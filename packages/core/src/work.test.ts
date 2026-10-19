import { describe, expect, it } from "vitest";
import { LIMITS } from "./onboarding";
import {
  DOMAINS,
  DOMAIN_IDS,
  WORK_LIMITS,
  checkLink,
  experienceSuggestion,
  projectEntry,
  projectSuggestion,
  roleEntry,
  workSchemas,
} from "./work";

const ok = (input: string) => {
  const r = checkLink(input);
  return r.ok ? r.url : null;
};

describe("checkLink", () => {
  it("accepts https and http links, normalised", () => {
    expect(ok("https://site.io/a")).toBe("https://site.io/a");
    expect(ok("http://x.dev")).toBe("http://x.dev/");
    expect(ok("  HTTPS://Site.IO/Path  ")).toBe("https://site.io/Path");
  });

  it("adds https to a bare host", () => {
    expect(ok("www.site.io")).toBe("https://www.site.io/");
    expect(ok("github.com/example/shopfront")).toBe(
      "https://github.com/example/shopfront",
    );
  });

  it("trims trailing punctuation", () => {
    expect(ok("https://site.io/a).")).toBe("https://site.io/a");
    expect(ok("www.site.io,")).toBe("https://www.site.io/");
  });

  it("refuses credentials, ports, IPs and other schemes", () => {
    for (const bad of [
      "https://u:p@x.io",
      "https://u@x.io",
      "https://x.io:8080",
      "http://127.0.0.1",
      "http://0x7f.1",
      "http://[::1]",
      "javascript:alert(1)",
      "data:text/html,<b>hi</b>",
      "ftp://x.io",
      "mailto:asha@site.io",
      "asha@site.io",
    ])
      expect(checkLink(bad), bad).toMatchObject({ ok: false });
  });

  it("refuses hosts without a dot and links over 300 characters", () => {
    expect(checkLink("https://localhost/a").ok).toBe(false);
    expect(checkLink("http://intranet").ok).toBe(false);
    expect(checkLink("").ok).toBe(false);
    expect(checkLink("https://site.io/a b").ok).toBe(false);
    const long = `https://site.io/${"a".repeat(290)}`;
    expect(long.length).toBeGreaterThan(300);
    expect(checkLink(long).ok).toBe(false);
    expect(checkLink(`https://site.io/${"a".repeat(280)}`).ok).toBe(true);
  });

  it("gives a message on failure", () => {
    const r = checkLink("javascript:alert(1)");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/http/);
  });
});

describe("domains", () => {
  it("DOMAIN_IDS are unique, lowercase and 30 long", () => {
    expect(DOMAIN_IDS).toHaveLength(30);
    expect(new Set(DOMAIN_IDS).size).toBe(30);
    for (const id of DOMAIN_IDS) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("every domain alias is unique and isn't another domain's id", () => {
    const aliases = DOMAINS.flatMap((d) => d.aliases);
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const a of aliases) {
      expect(a).toBe(a.toLowerCase());
      expect(DOMAIN_IDS as readonly string[]).not.toContain(a);
    }
    for (const d of DOMAINS) expect(d.label.length).toBeGreaterThan(0);
  });
});

describe("limits", () => {
  it("LIMITS carries the work limits", () => {
    expect(LIMITS).toMatchObject(WORK_LIMITS);
    expect(WORK_LIMITS).toMatchObject({ projects: 8, roles: 6 });
  });
});

const project = {
  title: "Shopfront",
  summary: "A storefront for a real-estate agency.",
  role: "solo",
  kind: "client",
  skills: ["react", "nextjs"],
  categories: ["development"],
  domains: ["real-estate"],
  outcomes: ["Cut page load from 4 s to 1 s."],
  links: ["github.com/example/shopfront"],
  year: 2023,
};

const role = {
  title: "Frontend developer",
  organisation: "Acme Pay",
  organisationDescription: "a fintech payments company",
  employmentType: "full_time",
  start: { year: 2021, month: 1 },
  end: { year: 2023, month: 6 },
  current: false,
  summary: "Built the checkout.",
  highlights: ["Rebuilt the checkout in React."],
  skills: ["react"],
  categories: ["development"],
  domains: ["fintech"],
};

describe("projectEntry", () => {
  it("draft allows empty fields", () => {
    const parsed = projectEntry(false).parse({});
    expect(parsed).toMatchObject({
      title: "",
      summary: "",
      role: "unknown",
      kind: "unknown",
      skills: [],
      outcomes: [],
      links: [],
      year: null,
    });
    expect(
      projectEntry(false).safeParse({ title: "", outcomes: [""], links: [""] })
        .success,
    ).toBe(true);
  });

  it("complete needs title and summary", () => {
    expect(projectEntry(true).safeParse(project).success).toBe(true);
    const r = projectEntry(true).safeParse({
      ...project,
      title: " ",
      summary: "",
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path.join("."))).toEqual(
      expect.arrayContaining(["title", "summary"]),
    );
  });

  it("complete normalises links and refuses a bad one", () => {
    expect(projectEntry(true).parse(project).links).toEqual([
      "https://github.com/example/shopfront",
    ]);
    const r = projectEntry(true).safeParse({
      ...project,
      links: ["javascript:alert(1)"],
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(["links", 0]);
  });

  it("refuses unknown skills, categories, domains and keys", () => {
    const bad = (patch: object) =>
      projectEntry(false).safeParse({ ...project, ...patch }).success;
    expect(bad({ skills: ["nope"] })).toBe(false);
    expect(bad({ categories: ["knitting"] })).toBe(false);
    expect(bad({ domains: ["space"] })).toBe(false);
    expect(bad({ kind: "side" })).toBe(false);
    expect(bad({ year: 1800 })).toBe(false);
    expect(bad({ extra: 1 })).toBe(false);
  });
});

describe("roleEntry", () => {
  it("complete needs title and organisationDescription", () => {
    expect(roleEntry(true).safeParse(role).success).toBe(true);
    const r = roleEntry(true).safeParse({
      ...role,
      title: "",
      organisationDescription: "",
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path.join("."))).toEqual(
      expect.arrayContaining(["title", "organisationDescription"]),
    );
    expect(roleEntry(true).safeParse({ ...role, summary: "" }).success).toBe(
      true,
    );
  });

  it("refuses an end before the start", () => {
    const bad = (end: object) =>
      roleEntry(true).safeParse({ ...role, end }).success;
    expect(bad({ year: 2020, month: 12 })).toBe(false);
    expect(bad({ year: 2021, month: null })).toBe(true);
    const r = roleEntry(true).safeParse({
      ...role,
      start: { year: 2022, month: 5 },
      end: { year: 2022, month: 3 },
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(["end"]);
  });

  it("allows a current role with no end, and drops an end on a current role", () => {
    expect(
      roleEntry(true).parse({ ...role, end: null, current: true }),
    ).toMatchObject({ end: null, current: true });
    expect(roleEntry(true).parse({ ...role, current: true })).toMatchObject({
      end: null,
      current: true,
    });
  });

  it("refuses bad months", () => {
    expect(
      roleEntry(false).safeParse({ ...role, start: { year: 2021, month: 13 } })
        .success,
    ).toBe(false);
  });

  it("freelance and contract roles lose their organisation", () => {
    for (const employmentType of ["freelance", "contract"])
      for (const complete of [false, true])
        expect(
          roleEntry(complete).parse({ ...role, employmentType }).organisation,
        ).toBeNull();
    expect(roleEntry(true).parse(role).organisation).toBe("Acme Pay");
    expect(roleEntry(false).parse({ organisation: " " }).organisation).toBe(
      null,
    );
  });
});

describe("entries", () => {
  it("refuse more than the limits", () => {
    const skills = [
      "react",
      "nextjs",
      "nodejs",
      "python",
      "django",
      "vue",
      "svelte",
      "php",
      "laravel",
      "javascript",
      "typescript",
    ];
    const bad = (patch: object) =>
      projectEntry(false).safeParse({ ...project, ...patch }).success;
    expect(bad({ skills })).toBe(false);
    expect(bad({ skills: skills.slice(0, 10) })).toBe(true);
    expect(bad({ links: ["a.io", "b.io", "c.io", "d.io"] })).toBe(false);
    expect(bad({ outcomes: ["a", "b", "c", "d"] })).toBe(false);
    expect(
      bad({ domains: ["retail", "fintech", "health", "travel", "media"] }),
    ).toBe(false);
    expect(bad({ categories: ["development", "design", "video"] })).toBe(false);
    expect(bad({ title: "x".repeat(81) })).toBe(false);
    expect(bad({ summary: "x".repeat(161) })).toBe(false);
    expect(
      roleEntry(false).safeParse({
        ...role,
        highlights: ["a", "b", "c", "d", "e"],
      }).success,
    ).toBe(false);
    expect(
      roleEntry(false).safeParse({
        ...role,
        organisationDescription: "x".repeat(61),
      }).success,
    ).toBe(false);
  });

  it("namesRemoved, hidden and source have defaults", () => {
    for (const parsed of [
      projectEntry(true).parse(project),
      roleEntry(true).parse(role),
    ])
      expect(parsed).toMatchObject({
        namesRemoved: false,
        hidden: false,
        source: "manual",
      });
    expect(
      projectEntry(false).safeParse({ ...project, source: "github" }).success,
    ).toBe(false);
  });
});

describe("workSchemas", () => {
  it("complete accepts empty lists; mentionEmployers defaults to false", () => {
    expect(
      workSchemas.complete.parse({ projects: [], experience: [] }),
    ).toEqual({ projects: [], experience: [], mentionEmployers: false });
    expect(workSchemas.draft.parse({})).toEqual({
      projects: [],
      experience: [],
      mentionEmployers: false,
    });
  });

  it("refuses more than 8 projects or 6 roles, and unknown keys", () => {
    expect(
      workSchemas.draft.safeParse({ projects: Array(9).fill(project) }).success,
    ).toBe(false);
    expect(
      workSchemas.draft.safeParse({ experience: Array(7).fill(role) }).success,
    ).toBe(false);
    expect(workSchemas.draft.safeParse({ extra: 1 }).success).toBe(false);
  });

  it("complete checks every entry; draft doesn't", () => {
    const data = { projects: [{ ...project, title: "" }], experience: [] };
    expect(workSchemas.draft.safeParse(data).success).toBe(true);
    const r = workSchemas.complete.safeParse(data);
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(["projects", 0, "title"]);
  });
});

describe("suggestions", () => {
  const { links: _links, ...noLinks } = project;
  it("are entries without source and hidden", () => {
    expect(
      projectSuggestion.parse({ ...noLinks, links: ["https://site.io/"] }),
    ).toMatchObject({ namesRemoved: false });
    expect(
      projectSuggestion.safeParse({ ...project, source: "resume" }).success,
    ).toBe(false);
    expect(
      experienceSuggestion.safeParse({ ...role, hidden: false }).success,
    ).toBe(false);
    expect(
      experienceSuggestion.parse({ ...role, namesRemoved: true }).namesRemoved,
    ).toBe(true);
  });

  it("need a title and refuse links that fail checkLink", () => {
    expect(projectSuggestion.safeParse({ ...project, title: "" }).success).toBe(
      false,
    );
    expect(
      projectSuggestion.safeParse({ ...project, links: ["ftp://x.io"] })
        .success,
    ).toBe(false);
    expect(
      experienceSuggestion.parse({ ...role, employmentType: "contract" })
        .organisation,
    ).toBeNull();
  });
});
