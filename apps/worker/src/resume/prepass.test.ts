import { describe, expect, it } from "vitest";
import { githubFromText, MAX_SHORTLIST, skillShortlist } from "./prepass";
import { splitSections } from "./sections";

describe("skillShortlist", () => {
  it("finds react from React.js and csharp from C#", () => {
    const text = "I build apps with React.js and C# daily.";
    const ids = skillShortlist(text, splitSections(text));
    expect(ids).toContain("react");
    expect(ids).toContain("csharp");
  });
  it("ignores short labels outside the skills section", () => {
    const text = "About\nI like c and r a lot\nSkills\nPython";
    const ids = skillShortlist(text, splitSections(text));
    expect(ids).toContain("python");
    expect(ids).not.toContain("cpp");
  });
  it("counts short labels inside the skills section", () => {
    const text = "About\nHi\nSkills\nC, Python";
    expect(skillShortlist(text, splitSections(text))).toContain("cpp");
  });
  it("does not match inside other words", () => {
    const text = "I love reactive programming";
    expect(skillShortlist(text, splitSections(text))).not.toContain("react");
  });
  it("orders by first match and caps the list", () => {
    const text = "Python then React";
    const ids = skillShortlist(text, splitSections(text));
    expect(ids.indexOf("python")).toBeLessThan(ids.indexOf("react"));
    const all = "Skills\n" + ["python", "react", "javascript", "typescript", "java", "go", "rust", "php", "ruby", "swift", "kotlin", "sql", "html", "css", "docker", "aws", "figma", "photoshop", "premiere pro", "after effects", "wordpress", "shopify", "seo", "node.js", "vue", "angular", "django", "flask", "laravel", "mongodb", "postgresql", "mysql", "redis", "graphql", "kubernetes", "linux", "git", "excel", "copywriting", "illustrator", "blender", "unity", "unreal engine", "flutter", "react native", "tensorflow", "pytorch", "pandas", "tableau", "power bi", "webflow", "canva", "davinci resolve", "final cut pro", "next.js", "tailwind", "sass", "jquery", "bootstrap", "c++", "scala", "elixir", "dart", "firebase", "supabase"].join(", ");
    const r = skillShortlist(all, splitSections(all));
    expect(r.length).toBeLessThanOrEqual(MAX_SHORTLIST);
    expect(new Set(r).size).toBe(r.length);
  });
});

describe("shortlist boundaries", () => {
  const ids = (t: string) => skillShortlist(t, splitSections(t));
  it("C# does not imply C/C++", () => {
    const r = ids("Skills\nC#, .NET, Objective-C");
    expect(r).toContain("csharp");
    expect(r).not.toContain("cpp");
  });
  it("business phrases do not match", () => {
    const r = ids("Skills\nC-suite, go-to-market, R&D");
    for (const id of ["cpp", "go", "statistics"]) expect(r).not.toContain(id);
  });
  it("C, C++, R in a skills section still match", () => {
    const r = ids("Skills\nC, C++, R");
    expect(r).toContain("cpp");
  });
});

describe("hyphenated matches", () => {
  const ids = (t: string) => skillShortlist(t, splitSections(t));
  it("matches -based and Ruby-on-Rails text", () => {
    expect(ids("React-based apps")).toContain("react");
    expect(ids("Python-based tools")).toContain("python");
    expect(ids("Ruby-on-Rails apps")).toContain("ruby");
    expect(ids("C-suite go-to-market")).not.toContain("go");
  });
});

describe("githubFromText", () => {
  it("skips reserved pages and returns the next valid profile", () => {
    const t = "see github.com/settings and https://github.com/octocat/repo";
    expect(githubFromText(t)).toBe("octocat");
  });
  it("returns null when none", () => {
    expect(githubFromText("no links")).toBeNull();
  });
  it("trims trailing punctuation and needs a left boundary", () => {
    expect(githubFromText("code: github.com/octocat.")).toBe("octocat");
    expect(githubFromText("evilgithub.com/foo")).toBeNull();
    expect(githubFromText("x.github.com/foo")).toBeNull();
  });
});
