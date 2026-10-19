import { describe, expect, it } from "vitest";
import { suggestionsSchema } from "@redlance/core";
import { mapGithubToSuggestions, type GithubRepo } from "./map";

const r = (o: Partial<GithubRepo>): GithubRepo => ({
  name: "x",
  fork: false,
  archived: false,
  language: null,
  topics: [],
  stargazers_count: 0,
  pushed_at: "2026-01-01T00:00:00Z",
  description: null,
  ...o,
});
const lvl = (s: ReturnType<typeof mapGithubToSuggestions>, id: string) =>
  s.skills.find((x) => x.id === id)?.level;

describe("mapGithubToSuggestions", () => {
  it("maps languages and topics with core/secondary levels", () => {
    const s = mapGithubToSuggestions({
      login: "octocat",
      name: "Octo Cat",
      repos: [
        r({ language: "TypeScript", topics: ["react"], stargazers_count: 9 }),
        r({ language: "Python" }),
        r({ language: "Python" }),
        r({ language: "Python" }),
        r({ language: "PHP" }),
      ],
    });
    expect(lvl(s, "typescript")).toBe("core"); // top repo
    expect(lvl(s, "python")).toBe("core"); // 3 repos
    expect(lvl(s, "php")).toBe("secondary");
    expect(s.basics.displayName).toBe("Octo Cat");
    expect(s.basics.categories).toEqual(["development"]);
    expect(s.githubUsername).toBe("octocat");
    expect(suggestionsSchema.safeParse(s).success).toBe(true);
  });

  it("ignores forks and archived repos", () => {
    const s = mapGithubToSuggestions({
      login: "o",
      name: null,
      repos: [
        r({ language: "Python", fork: true }),
        r({ language: "PHP", archived: true }),
      ],
    });
    expect(s.skills).toEqual([]);
    expect(s.basics.displayName).toBeUndefined();
    expect(s.basics.categories).toBeUndefined();
    expect(suggestionsSchema.safeParse(s).success).toBe(true);
  });

  it("caps core at 8 and total at 30", () => {
    const langs = [
      "JavaScript",
      "TypeScript",
      "Python",
      "PHP",
      "Go",
      "Rust",
      "Java",
      "Ruby",
      "Swift",
      "Kotlin",
      "C#",
      "C++",
    ];
    const repos = langs.flatMap((l) => [
      r({ language: l }),
      r({ language: l }),
      r({ language: l }),
    ]);
    const s = mapGithubToSuggestions({ login: "o", name: null, repos });
    expect(
      s.skills.filter((x) => x.level === "core").length,
    ).toBeLessThanOrEqual(8);
    expect(s.skills.length).toBeLessThanOrEqual(30);
    expect(suggestionsSchema.safeParse(s).success).toBe(true);
  });
});
