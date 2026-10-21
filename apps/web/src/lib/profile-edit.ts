import type { StepDraft, StepId } from "@redlance/core";

// Profile edit (`/profile`): the sections a finished profile can change, the weekly limit, and
// the comparison that decides whether a save changed anything. Pure: used by the server and the
// browser. docs/onboarding/profile-edit.md.

/** Same list as `PROFILE_SECTIONS` in @redlance/db (a test keeps them equal). */
export const PROFILE_SECTIONS = [
  "basics",
  "skills",
  "work",
  "rates",
  "github",
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** Each section is validated with the onboarding step it came from. */
export const SECTION_STEP = {
  basics: "basics",
  skills: "skills",
  work: "work",
  rates: "rates",
  github: "import",
} as const satisfies Record<ProfileSection, StepId>;

export type SectionData<K extends ProfileSection> = StepDraft<
  (typeof SECTION_STEP)[K]
>;
export type ProfileSections = { [K in ProfileSection]: SectionData<K> };

export const SECTION_TITLES: Record<ProfileSection, string> = {
  basics: "Basics",
  skills: "Skills",
  work: "Projects & experience",
  rates: "Rates & filters",
  github: "GitHub",
};

export const isProfileSection = (v: string): v is ProfileSection =>
  (PROFILE_SECTIONS as readonly string[]).includes(v);

// ---------- the weekly limit ----------

export const PROFILE_EDIT_LIMIT = 5;
export const PROFILE_EDIT_WINDOW_DAYS = 7;
const WINDOW_MS = PROFILE_EDIT_WINDOW_DAYS * 86_400_000;

export type EditAllowance = {
  limit: number;
  /** Changes in the last 7 days. */
  used: number;
  remaining: number;
  /** ISO time the next change frees up (the oldest counted change turns 7 days old); null if none is used. */
  nextFreeAt: string | null;
};

/** The allowance from the times of recent changes, over a rolling 7-day window ending at `now`. */
export function computeAllowance(
  changeTimes: readonly Date[],
  now: Date,
  limit = PROFILE_EDIT_LIMIT,
): EditAllowance {
  const since = now.getTime() - WINDOW_MS;
  const recent = changeTimes
    .map((t) => t.getTime())
    .filter((t) => t > since)
    .sort((a, b) => a - b);
  const used = recent.length;
  // With more than `limit` (never normally), several must expire before one is free again.
  const freeing = recent[Math.max(0, used - limit)];
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    nextFreeAt:
      freeing === undefined
        ? null
        : new Date(freeing + WINDOW_MS).toISOString(),
  };
}

/** "Thu, Oct 23, 2:05 PM" in the given time zone (the profile's). */
export function formatFreeAt(iso: string, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(
      new Date(iso),
    );
  } catch {
    return new Intl.DateTimeFormat("en-US", options).format(new Date(iso));
  }
}

/** The allowance line under the page title, and when the next change frees up. */
export function allowanceText(
  a: EditAllowance,
  timeZone?: string,
): { summary: string; next: string | null } {
  const summary =
    a.remaining === 0
      ? "No changes left this week"
      : `${a.remaining} of ${a.limit} ${a.limit === 1 ? "change" : "changes"} left this week`;
  const next = a.nextFreeAt
    ? `${a.remaining === 0 ? "Next one frees up" : "One more frees up"} ${formatFreeAt(a.nextFreeAt, timeZone)}`
    : null;
  return { summary, next };
}

// ---------- did a save change anything? ----------

/** JSON with object keys sorted, so two equal values always give the same text. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

/** `namesRemoved` only drives an onboarding note and isn't stored, so it never counts. */
export function withoutNamesRemoved<T extends object>(
  entry: T,
): Omit<T, "namesRemoved"> {
  const copy: Partial<T> & { namesRemoved?: unknown } = { ...entry };
  delete copy.namesRemoved;
  return copy as Omit<T, "namesRemoved">;
}

type SkillsLike = { skills: readonly { id: string }[] };
type WorkLike = {
  projects: readonly object[];
  experience: readonly object[];
};

/**
 * The form of a section that matters for "changed": skills are a set (stored without order),
 * project and role order does matter (drafts use it), and keys are sorted.
 */
export function sectionKey(section: ProfileSection, data: unknown): string {
  if (section === "skills") {
    const v = data as SkillsLike;
    return stableJson({
      ...v,
      skills: [...v.skills].sort((a, b) => (a.id < b.id ? -1 : 1)),
    });
  }
  if (section === "work") {
    const v = data as WorkLike;
    return stableJson({
      ...v,
      projects: v.projects.map(withoutNamesRemoved),
      experience: v.experience.map(withoutNamesRemoved),
    });
  }
  return stableJson(data);
}

export const sameSection = (
  section: ProfileSection,
  a: unknown,
  b: unknown,
): boolean => sectionKey(section, a) === sectionKey(section, b);
