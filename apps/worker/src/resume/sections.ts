export type ResumeSections = {
  top: string;
  summary: string;
  experience: string;
  skills: string;
  projects: string;
  education: string;
  other: string;
};

type Key = Exclude<keyof ResumeSections, "top">;

/** Words that may stand next to "skills" in a skills heading. */
const SKILL_WORDS =
  "(technical|key|core|professional|relevant|soft|hard|other|additional|computer|software|it|digital|creative|design|programming|language|languages|transferable|and|tools|interests|summary|expertise|technologies|competencies)";

/**
 * Whole-line headings (after `normalise`). Conservative on purpose: a false match cuts a
 * section in two, which is worse than a miss (a missed heading only appends its lines to
 * the section above). `other` holds headings we don't read but that must end the section
 * above, or "Achievements" lands in the projects section as extra project blocks.
 */
const HEADINGS: [Key, RegExp][] = [
  [
    "summary",
    /^(summary|profile|about( me)?|objective|professional summary)$/i,
  ],
  [
    "experience",
    /^((work|professional|relevant|freelance|industry)\s+)?experience$|^(employment( history)?|work history|career history|internships?)$/i,
  ],
  [
    "skills",
    // "Skills" with up to three known words around it ("Technical Skills and Interests",
    // "Skills & Tools", "Key Skills", "Skills Summary"), plus the usual synonyms. The words
    // are a fixed list so a short body line like "Taught coding skills" isn't a heading.
    new RegExp(
      `^(${SKILL_WORDS} ){0,3}skills?( ${SKILL_WORDS}){0,3}$|^(tech(nical)? stack|technologies|tools|tools and technologies|technologies and tools|core competencies|competencies|(areas of )?expertise)$`,
      "i",
    ),
  ],
  [
    "projects",
    /^((personal|key|side|selected|notable|academic|university|capstone|freelance|client|independent|open[- ]source)\s+)?projects?$|^(portfolio|selected work|client work|case studies|open[- ]source( contributions)?|hackathons?)$/i,
  ],
  [
    "education",
    /^(education|academic background|certifications?|licen[cs]es( and certifications)?|certifications and licen[cs]es|courses|(relevant )?coursework)$/i,
  ],
  [
    "other",
    // Not paid work, so not experience: the experience call models jobs with an employment
    // type. Positions of responsibility, leadership and volunteering go here. "Languages" is
    // left out: under a Skills section it often lists programming languages.
    /^(achievements?|awards?|honou?rs?( and awards)?|awards and (honou?rs|achievements)|accomplishments|positions? of responsibility|leadership( experience)?|extra[- ]?curricular( activities)?|activities|volunteer(ing)?( experience| work)?|publications?|interests|hobbies( and interests)?|interests and hobbies|references?)$/i,
  ],
];

/**
 * Trims, drops leading emoji icons ("📁 Projects") and a trailing colon, joins letter-spaced
 * words ("E X P E R I E N C E", words split by two or more spaces), squeezes spaces and
 * turns `&` into "and". List bullets ("–", "•", "▪", symbol-font bullets) and numbering are
 * NOT stripped: a bulleted line is body text, and "– Tech Stack:" inside a project must not
 * become a Skills heading (it did on a real resume, cutting the projects section in two).
 */
function normalise(line: string): string {
  const raw = line
    .trim()
    .replace(/^(?:[\u{1F000}-\u{1FAFF}]\uFE0F?\s*)+/u, "")
    .replace(/\s*:\s*$/, "");
  const words = raw.split(/\s{2,}/);
  const letterSpaced =
    raw.split(/\s+/).length >= 3 &&
    words.every((w) => /^(\p{L} )+\p{L}$/u.test(w));
  const t = letterSpaced
    ? words.map((w) => w.replace(/ /g, "")).join(" ")
    : raw.replace(/\s+/g, " ");
  return t.replace(/\s*&\s*/g, " and ");
}

function headingOf(line: string): Key | null {
  const t = normalise(line);
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
