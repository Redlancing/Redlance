import { z } from "zod";
import { isCountryCode } from "./countries";
import { CATEGORY_IDS, SKILL_BY_ID, normalizeSkillName } from "./taxonomy";

export const STEP_IDS = ["import", "basics", "skills", "rates"] as const;
export type StepId = (typeof STEP_IDS)[number];
export const PAGE_IDS = [...STEP_IDS, "review"] as const;
export type PageId = (typeof PAGE_IDS)[number];
export type StepStatus = "draft" | "completed";

export const PAGE_TITLES: Record<PageId, string> = {
  import: "Import",
  basics: "Basics",
  skills: "Skills",
  rates: "Rates & filters",
  review: "Review",
};

export const TRIAL_DAYS = 5;
export const EXPERIENCE_LEVELS = [
  "beginner",
  "intermediate",
  "experienced",
] as const;
export const SKILL_LEVELS = ["core", "secondary"] as const;
export const SOURCES = ["manual", "resume", "github"] as const;
export const CURRENCIES = ["USD", "GBP", "EUR", "INR"] as const;
export const RATE_TYPES = ["hourly", "fixed", "either"] as const;

export const LIMITS = {
  displayName: 60,
  headline: 120,
  categories: 3,
  coreSkills: 8,
  totalSkills: 30,
  customSkillName: 40,
  maxRate: 100_000,
  blockedWords: 50,
  blockedWord: 40,
} as const;

// ---------- small validators (also used by the forms) ----------

export const GITHUB_USERNAME_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * "octocat", "@octocat" or any github.com/<name>/… URL → "octocat".
 * null when the input is empty or can't be a GitHub username.
 */
export function parseGithubUsername(input: string): string | null {
  let value = input.trim().replace(/^@/, "");
  if (!value) return null;
  const fromUrl = value.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)/i,
  );
  if (fromUrl) value = fromUrl[1]!;
  else if (/[/.:]/.test(value)) return null;
  return GITHUB_USERNAME_RE.test(value) ? value : null;
}

const TZ_RE = /^(?:UTC|[A-Za-z][A-Za-z_-]*(?:\/[A-Za-z0-9_+-]+){1,2})$/;

export function isValidTimeZone(value: string): boolean {
  if (!TZ_RE.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const twoDecimals = (n: number) =>
  Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

// ---------- field schemas ----------

const text = (max: number) =>
  z.string().trim().max(max, `Keep it to ${max} characters or fewer.`);
const categoryId = z.enum(CATEGORY_IDS, {
  error: "Pick a job type from the list.",
});
const skillId = z
  .string()
  .refine((id) => SKILL_BY_ID.has(id), "Unknown skill.");
const source = z.enum(SOURCES).default("manual");
const country = z
  .string({ error: "Pick your country." })
  .refine(isCountryCode, "Pick your country.");
const timeZone = z
  .string({ error: "Pick your time zone." })
  .max(64)
  .refine(isValidTimeZone, "Pick your time zone.");
const rate = z
  .number({ error: "Enter a number." })
  .min(0, "Can't be negative.")
  .max(LIMITS.maxRate, "That's above the limit.")
  .refine(twoDecimals, "Use at most 2 decimal places.");

type Ctx = z.RefinementCtx;

function noDuplicates<T>(
  items: readonly T[],
  key: (item: T) => string,
  ctx: Ctx,
  path: (string | number)[],
  message: string,
) {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const k = key(item);
    if (k && seen.has(k))
      ctx.addIssue({ code: "custom", message, path: [...path, i] });
    seen.add(k);
  });
}

// ---------- steps ----------

// Import step: an optional GitHub link, stored as the bare username (the form parses URLs).
const importData = z.strictObject({
  githubUsername: z
    .string()
    .regex(GITHUB_USERNAME_RE, "That doesn't look like a GitHub username.")
    .nullable()
    .default(null),
});

const basicsShape = {
  headline: text(LIMITS.headline).default(""),
};
const categoriesRefine = (v: { categories: string[] }, ctx: Ctx) =>
  noDuplicates(
    v.categories,
    (c) => c,
    ctx,
    ["categories"],
    "Each job type once.",
  );

const basicsDraft = z
  .strictObject({
    ...basicsShape,
    displayName: text(LIMITS.displayName).default(""),
    categories: z
      .array(categoryId)
      .max(LIMITS.categories, "Pick up to 3 job types.")
      .default([]),
    experienceLevel: z.enum(EXPERIENCE_LEVELS).nullable().default(null),
    country: country.nullable().default(null),
    timeZone: timeZone.nullable().default(null),
  })
  .superRefine(categoriesRefine);

const basicsComplete = z
  .strictObject({
    ...basicsShape,
    displayName: text(LIMITS.displayName).min(
      1,
      "Add the name clients will see.",
    ),
    categories: z
      .array(categoryId)
      .min(1, "Pick at least one job type.")
      .max(LIMITS.categories, "Pick up to 3 job types."),
    experienceLevel: z.enum(EXPERIENCE_LEVELS, {
      error: "Pick your experience level.",
    }),
    country,
    timeZone,
  })
  .superRefine(categoriesRefine);

const skillEntry = z.strictObject({
  id: skillId,
  level: z.enum(SKILL_LEVELS),
  source,
});
/** A custom skill name must show something: at least one letter or digit (no "\u200b" or "--"). */
export const isUsableSkillName = (name: string) => /[\p{L}\p{N}]/u.test(name);

const customSkillEntry = z.strictObject({
  name: text(LIMITS.customSkillName)
    .min(1, "Name the skill.")
    .refine(isUsableSkillName, "Use letters or numbers."),
  level: z.enum(SKILL_LEVELS),
  source,
});

function skillsSchema(requireCore: boolean) {
  return z
    .strictObject({
      skills: z.array(skillEntry).max(LIMITS.totalSkills).default([]),
      customSkills: z
        .array(customSkillEntry)
        .max(LIMITS.totalSkills)
        .default([]),
    })
    .superRefine((v, ctx) => {
      noDuplicates(v.skills, (s) => s.id, ctx, ["skills"], "Already added.");
      noDuplicates(
        v.customSkills,
        (s) => normalizeSkillName(s.name),
        ctx,
        ["customSkills"],
        "Already added.",
      );
      const all = [...v.skills, ...v.customSkills];
      const core = all.filter((s) => s.level === "core").length;
      if (all.length > LIMITS.totalSkills)
        ctx.addIssue({
          code: "custom",
          path: ["skills"],
          message: `Keep it to ${LIMITS.totalSkills} skills.`,
        });
      if (core > LIMITS.coreSkills)
        ctx.addIssue({
          code: "custom",
          path: ["skills"],
          message: `Mark up to ${LIMITS.coreSkills} skills as core.`,
        });
      if (requireCore && core === 0)
        ctx.addIssue({
          code: "custom",
          path: ["skills"],
          message: "Mark at least one skill as core.",
        });
    });
}

const blockedWords = z
  .array(text(LIMITS.blockedWord).min(1))
  .max(LIMITS.blockedWords, `Up to ${LIMITS.blockedWords} words.`)
  .default([]);
const wordsRefine = (v: { blockedWords: string[] }, ctx: Ctx) =>
  noDuplicates(
    v.blockedWords,
    (w) => w.toLowerCase(),
    ctx,
    ["blockedWords"],
    "Already added.",
  );

const ratesDraft = z
  .strictObject({
    minRate: rate.nullable().default(null),
    currency: z.enum(CURRENCIES).nullable().default(null),
    rateType: z.enum(RATE_TYPES).nullable().default(null),
    remoteOnly: z.boolean().default(false),
    blockedWords,
  })
  .superRefine(wordsRefine);
const ratesComplete = z
  .strictObject({
    minRate: rate,
    currency: z.enum(CURRENCIES, { error: "Pick a currency." }),
    rateType: z.enum(RATE_TYPES, { error: "Pick hourly, fixed or either." }),
    remoteOnly: z.boolean().default(false),
    blockedWords,
  })
  .superRefine(wordsRefine);

export const STEP_SCHEMAS = {
  import: { draft: importData, complete: importData },
  basics: { draft: basicsDraft, complete: basicsComplete },
  skills: { draft: skillsSchema(false), complete: skillsSchema(true) },
  rates: { draft: ratesDraft, complete: ratesComplete },
} as const;

export type StepDraft<S extends StepId> = z.output<
  (typeof STEP_SCHEMAS)[S]["draft"]
>;
export type StepData<S extends StepId> = z.output<
  (typeof STEP_SCHEMAS)[S]["complete"]
>;

export function emptyDraft<S extends StepId>(step: S): StepDraft<S> {
  return STEP_SCHEMAS[step].draft.parse({}) as StepDraft<S>;
}

// ---------- order ----------

export const isStepId = (v: string): v is StepId =>
  (STEP_IDS as readonly string[]).includes(v);
export const isPageId = (v: string): v is PageId =>
  (PAGE_IDS as readonly string[]).includes(v);
export const pageIndex = (page: PageId) => PAGE_IDS.indexOf(page);

/** First step that is missing or a draft; "review" once all are completed. */
export function resumeAt(
  rows: ReadonlyArray<{ step: string; status: StepStatus }>,
): PageId {
  const done = new Set(
    rows.filter((r) => r.status === "completed").map((r) => r.step),
  );
  return STEP_IDS.find((s) => !done.has(s)) ?? "review";
}

export const canOpen = (page: PageId, resume: PageId) =>
  pageIndex(page) <= pageIndex(resume);
export const nextPage = (step: StepId): PageId =>
  PAGE_IDS[pageIndex(step) + 1]!;
export const previousPage = (page: PageId): PageId | null =>
  pageIndex(page) > 0 ? PAGE_IDS[pageIndex(page) - 1]! : null;

// ---------- errors ----------

export type FieldError = { path: string; message: string };

export function toFieldErrors(
  error: z.ZodError,
  prefix?: string,
): FieldError[] {
  return error.issues.map((issue) => ({
    path: [...(prefix ? [prefix] : []), ...issue.path.map(String)].join("."),
    message: issue.message,
  }));
}
