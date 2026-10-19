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
    /^((work|professional|relevant|freelance|industry)\s+)?experience$|^(employment( history)?|work history|career history|internships?)$/i,
  ],
  [
    "skills",
    /^(skills|technical skills|tech(nical)? stack|tools|core competencies)$/i,
  ],
  [
    "projects",
    /^((personal|key|side|selected|notable|academic|university|capstone|freelance|client|independent|open[- ]source)\s+)?projects?$|^(portfolio|selected work|client work|case studies|open[- ]source( contributions)?|hackathons?)$/i,
  ],
  ["education", /^(education|certifications?|courses)$/i],
];

function headingOf(line: string): Key | null {
  const t = line.trim().replace(/:$/, "").trim();
  if (!t || t.length > 40) return null;
  return HEADINGS.find(([, re]) => re.test(t))?.[0] ?? null;
}

/** The sections, and whether any heading was found (with none, every section is the whole text). */
export function splitSectionsWithFlag(text: string): {
  sections: ResumeSections;
  headed: boolean;
} {
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
      headed: false,
      sections: {
        top: text,
        summary: text,
        experience: text,
        skills: text,
        projects: text,
        education: text,
        other: text,
      },
    };
  const join = (k: keyof ResumeSections) => buckets[k].join("\n").trim();
  return {
    headed: true,
    sections: {
      top: join("top"),
      summary: join("summary"),
      experience: join("experience"),
      skills: join("skills"),
      projects: join("projects"),
      education: join("education"),
      other: join("other"),
    },
  };
}

export function splitSections(text: string): ResumeSections {
  return splitSectionsWithFlag(text).sections;
}
