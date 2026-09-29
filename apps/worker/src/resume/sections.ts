export type ResumeSections = {
  top: string;
  summary: string;
  experience: string;
  skills: string;
  projects: string;
  education: string;
  other: string;
};

type Key = Exclude<keyof ResumeSections, "top" | "other">;

const HEADINGS: [Key, RegExp][] = [
  ["summary", /^(summary|profile|about( me)?|objective)$/i],
  [
    "experience",
    /^((work |professional )?experience|employment( history)?|work history)$/i,
  ],
  [
    "skills",
    /^(skills|technical skills|tech(nical)? stack|tools|core competencies)$/i,
  ],
  ["projects", /^(projects|portfolio|selected work)$/i],
  ["education", /^(education|certifications?|courses)$/i],
];

function headingOf(line: string): Key | null {
  const t = line.trim().replace(/:$/, "").trim();
  if (!t || t.length > 40) return null;
  return HEADINGS.find(([, re]) => re.test(t))?.[0] ?? null;
}

export function splitSections(text: string): ResumeSections {
  const buckets: Record<keyof ResumeSections, string[]> = {
    top: [],
    summary: [],
    experience: [],
    skills: [],
    projects: [],
    education: [],
    other: [],
  };
  let current: keyof ResumeSections = "top";
  let found = false;
  for (const line of text.split("\n")) {
    const h = headingOf(line);
    if (h) {
      found = true;
      current = h;
    } else buckets[current].push(line);
  }
  if (!found)
    return {
      top: text,
      summary: text,
      experience: text,
      skills: text,
      projects: text,
      education: text,
      other: text,
    };
  const join = (k: keyof ResumeSections) => buckets[k].join("\n").trim();
  return {
    top: join("top"),
    summary: join("summary"),
    experience: join("experience"),
    skills: join("skills"),
    projects: join("projects"),
    education: join("education"),
    other: join("other"),
  };
}
