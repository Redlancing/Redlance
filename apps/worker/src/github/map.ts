import { LIMITS, SKILLS, type Suggestions } from "@redlance/core";

export type GithubRepo = {
  name: string;
  fork: boolean;
  archived: boolean;
  language: string | null;
  topics: string[];
  stargazers_count: number;
  pushed_at: string;
  description: string | null;
};

const byLanguage = new Map<string, string[]>();
const byTopic = new Map<string, string[]>();
const push = (m: Map<string, string[]>, key: string, id: string) => {
  const k = key.toLowerCase();
  const list = m.get(k);
  if (list) list.push(id);
  else m.set(k, [id]);
};
for (const s of SKILLS) {
  if (s.retired) continue;
  for (const l of s.githubLanguages ?? []) push(byLanguage, l, s.id);
  for (const t of s.githubTopics ?? []) push(byTopic, t, s.id);
}

/** The taxonomy skill ids a repo's language and topics map to. */
export function repoSkillIds(repo: GithubRepo): Set<string> {
  const ids = new Set<string>();
  if (repo.language)
    for (const id of byLanguage.get(repo.language.toLowerCase()) ?? [])
      ids.add(id);
  for (const t of repo.topics)
    for (const id of byTopic.get(t.toLowerCase()) ?? []) ids.add(id);
  return ids;
}

export function mapGithubToSuggestions(profile: {
  login: string;
  name: string | null;
  repos: GithubRepo[];
}): Suggestions {
  const repos = profile.repos.filter((r) => !r.fork && !r.archived);
  const top = [...repos].sort(
    (a, b) =>
      b.stargazers_count - a.stargazers_count ||
      Date.parse(b.pushed_at || "") - Date.parse(a.pushed_at || "") ||
      0,
  )[0];
  const topSkills = top ? repoSkillIds(top) : new Set<string>();

  const counts = new Map<string, number>();
  for (const r of repos)
    for (const id of repoSkillIds(r)) counts.set(id, (counts.get(id) ?? 0) + 1);

  const ranked = [...counts.entries()]
    .map(([id, n]) => ({ id, n, core: n >= 3 || topSkills.has(id) }))
    .sort((a, b) => Number(b.core) - Number(a.core) || b.n - a.n)
    .slice(0, LIMITS.totalSkills);

  let core = 0;
  const skills = ranked.map(({ id, core: isCore }) => {
    const level: "core" | "secondary" =
      isCore && core < LIMITS.coreSkills ? "core" : "secondary";
    if (level === "core") core += 1;
    return { id, level };
  });

  const cats = new Set(
    skills.map((s) => SKILLS.find((k) => k.id === s.id)?.category),
  );
  const categories = (["development", "games"] as const).filter((c) =>
    cats.has(c),
  );

  const name = profile.name?.trim().slice(0, LIMITS.displayName);
  return {
    v: 2,
    basics: {
      ...(name ? { displayName: name } : {}),
      ...(categories.length ? { categories } : {}),
    },
    skills,
    githubUsername: profile.login,
    // Projects come only from the resume, never from repos.
    projects: [],
    experience: [],
  };
}
