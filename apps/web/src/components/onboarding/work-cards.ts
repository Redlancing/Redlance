import {
  ORGANISATION_FREE_TYPES,
  WORK_LIMITS,
  checkLink,
  type MonthYear,
  type ResumeStepName,
  type RoleEmploymentType,
  type WorkDraft,
} from "@redlance/core";

// Pure helpers for the Projects & experience step (work-step.tsx). Entries have no ids in the
// saved data; the component keeps a parallel list of local keys (see fitKeys).

export type ProjectCard = WorkDraft["projects"][number];
export type RoleCard = WorkDraft["experience"][number];

/**
 * Note shown on the work step when the resume import couldn't fill projects or experience.
 * A step in `partial` ran and failed; a step in `skipped` didn't run because the resume has
 * no such section (or no headings at all), so it gets its own wording.
 */
export function partialNotice(
  partial: readonly ResumeStepName[],
  skipped: readonly ResumeStepName[],
): string | null {
  const failed = new Set<ResumeStepName>(partial);
  const absent = new Set<ResumeStepName>(skipped.filter((s) => !failed.has(s)));
  const notes: string[] = [];
  if (failed.has("projects") && failed.has("experience"))
    notes.push(
      "We couldn't read your projects or experience. Add them by hand.",
    );
  else if (failed.has("projects"))
    notes.push("We couldn't read your projects. Add them by hand.");
  else if (failed.has("experience"))
    notes.push("We couldn't read your experience. Add it by hand.");
  if (absent.has("projects") && absent.has("experience"))
    notes.push(
      "We didn't find a Projects or Experience section in your resume, so add them by hand.",
    );
  else if (absent.has("projects"))
    notes.push(
      "We didn't find a Projects section in your resume, so add any projects by hand.",
    );
  else if (absent.has("experience"))
    notes.push(
      "We didn't find an Experience section in your resume, so add your experience by hand.",
    );
  return notes.length ? notes.join(" ") : null;
}

export const emptyProject = (): ProjectCard => ({
  title: "",
  summary: "",
  role: "unknown",
  kind: "unknown",
  skills: [],
  categories: [],
  domains: [],
  outcomes: [],
  links: [],
  year: null,
  namesRemoved: false,
  source: "manual",
  hidden: false,
});

export const emptyRole = (): RoleCard => ({
  title: "",
  organisation: null,
  organisationDescription: "",
  employmentType: "unknown",
  start: null,
  end: null,
  current: false,
  summary: "",
  highlights: [],
  skills: [],
  categories: [],
  domains: [],
  namesRemoved: false,
  source: "manual",
  hidden: false,
});

/** Returns the same array when the limit is reached. */
export function addProject(list: readonly ProjectCard[]): ProjectCard[] {
  if (list.length >= WORK_LIMITS.projects) return list as ProjectCard[];
  return [...list, emptyProject()];
}

export function addRole(list: readonly RoleCard[]): RoleCard[] {
  if (list.length >= WORK_LIMITS.roles) return list as RoleCard[];
  return [...list, emptyRole()];
}

export const removeAt = <T>(list: readonly T[], index: number): T[] =>
  list.filter((_, i) => i !== index);

export const setLine = (
  lines: readonly string[],
  index: number,
  value: string,
): string[] => lines.map((l, i) => (i === index ? value : l));

/** Any edit to a card's content: the "Client name removed" note no longer applies. */
export function editEntry<T extends { namesRemoved: boolean }>(
  entry: T,
  patch: Partial<T>,
): T {
  return { ...entry, ...patch, namesRemoved: false };
}

/** "Use in replies" is the opposite of `hidden`. Not an edit of the text, so the note stays. */
export const toggleHidden = <T extends { hidden: boolean }>(entry: T): T => ({
  ...entry,
  hidden: !entry.hidden,
});

/** Freelance and contract roles keep no organisation (their "organisation" is often a client). */
export function setEmploymentType(
  role: RoleCard,
  employmentType: RoleEmploymentType,
): RoleCard {
  return editEntry(role, {
    employmentType,
    ...(ORGANISATION_FREE_TYPES.has(employmentType) && { organisation: null }),
  });
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const monthYear = (d: MonthYear) =>
  d.month ? `${MONTHS[d.month - 1]} ${d.year}` : String(d.year);

/** "Jan 2021 – Present", "2019 – 2022", "2023", or "" with no dates. */
export function formatDates(
  start: MonthYear | null,
  end: MonthYear | null,
  current: boolean,
): string {
  const to = current ? "Present" : end ? monthYear(end) : null;
  if (start && to) return `${monthYear(start)} – ${to}`;
  if (start) return monthYear(start);
  return to ?? "";
}

/** The reason a link is refused, or null if it is fine (or still empty). */
export function linkError(input: string): string | null {
  if (!input.trim()) return null;
  const check = checkLink(input);
  return check.ok ? null : check.message;
}

/** Local keys for the cards, kept the same length as the list (restore/discard can change it). */
export function fitKeys(
  keys: readonly string[],
  length: number,
  prefix: string,
): string[] {
  const out = keys.slice(0, length);
  for (let i = out.length; i < length; i++) out.push(`${prefix}-pad-${i}`);
  return out;
}
