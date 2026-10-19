import { z } from "zod";
import { CATEGORY_IDS, SKILL_BY_ID } from "./taxonomy";

// Projects and experience: the "Projects & experience" onboarding step and the
// resume suggestions that pre-fill it (docs/onboarding/projects-experience-design.md).
// This file must not import onboarding.ts: onboarding.ts builds its step schemas from it.

export const PROJECT_ROLES = ["solo", "lead", "team", "unknown"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];
export const PROJECT_KINDS = [
  "client",
  "employer",
  "personal",
  "open_source",
  "academic",
  "hackathon",
  "unknown",
] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];
// Named apart from job-post.ts's EMPLOYMENT_TYPES (what a post offers), which has no internship.
export const ROLE_EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "freelance",
  "contract",
  "internship",
  "unknown",
] as const;
export type RoleEmploymentType = (typeof ROLE_EMPLOYMENT_TYPES)[number];
export const ENTRY_SOURCES = ["resume", "manual"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

/** For these roles the "organisation" is often a client, so it is never kept. */
export const ORGANISATION_FREE_TYPES: ReadonlySet<RoleEmploymentType> = new Set(
  ["freelance", "contract"],
);

/** Merged into `LIMITS` in onboarding.ts. */
export const WORK_LIMITS = {
  projects: 8,
  roles: 6,
  entryTitle: 80,
  entrySummary: 160,
  organisation: 80,
  orgDescription: 60,
  outcomes: 3,
  highlights: 4,
  links: 3,
  linkLength: 300,
  entrySkills: 10,
  entryCategories: 2,
  domains: 4,
} as const;

// ---------- domains ----------

// A fixed list, so tags don't drift ("ecommerce", "online retail"). Aliases are for
// matching post text later. Waiting for the user's review (design doc, "Domain list").
export const DOMAINS = [
  {
    id: "e-commerce",
    label: "E-commerce",
    aliases: ["ecommerce", "online store", "shopify store"],
  },
  { id: "retail", label: "Retail", aliases: ["shops", "stores"] },
  { id: "fintech", label: "Fintech", aliases: ["payments", "neobank"] },
  {
    id: "finance",
    label: "Finance",
    aliases: ["banking", "insurance", "accounting"],
  },
  {
    id: "crypto",
    label: "Crypto & web3",
    aliases: ["web3", "blockchain", "defi"],
  },
  {
    id: "real-estate",
    label: "Real estate",
    aliases: ["property", "realtor"],
  },
  {
    id: "health",
    label: "Health",
    aliases: ["healthcare", "medical", "clinic"],
  },
  { id: "fitness", label: "Fitness & wellness", aliases: ["wellness", "gym"] },
  {
    id: "food",
    label: "Food & restaurants",
    aliases: ["restaurant", "food delivery"],
  },
  {
    id: "travel",
    label: "Travel & hospitality",
    aliases: ["hospitality", "hotel", "tourism"],
  },
  {
    id: "education",
    label: "Education",
    aliases: ["edtech", "school", "courses"],
  },
  { id: "gaming", label: "Gaming", aliases: ["games", "esports"] },
  { id: "saas", label: "SaaS", aliases: ["b2b software", "startup tools"] },
  {
    id: "marketing",
    label: "Marketing & advertising",
    aliases: ["advertising", "adtech", "agency"],
  },
  {
    id: "media",
    label: "Media & publishing",
    aliases: ["news", "publishing", "blog"],
  },
  {
    id: "entertainment",
    label: "Entertainment",
    aliases: ["film", "streaming", "events"],
  },
  { id: "music", label: "Music & audio", aliases: ["audio", "podcast"] },
  { id: "fashion", label: "Fashion", aliases: ["apparel", "clothing"] },
  { id: "beauty", label: "Beauty", aliases: ["cosmetics", "salon"] },
  { id: "automotive", label: "Automotive", aliases: ["cars", "dealership"] },
  {
    id: "logistics",
    label: "Logistics",
    aliases: ["shipping", "supply chain"],
  },
  {
    id: "manufacturing",
    label: "Manufacturing",
    aliases: ["industrial", "factory"],
  },
  {
    id: "construction",
    label: "Construction & architecture",
    aliases: ["architecture", "contractors"],
  },
  { id: "energy", label: "Energy", aliases: ["solar", "utilities"] },
  { id: "legal", label: "Legal", aliases: ["law firm", "compliance"] },
  { id: "non-profit", label: "Non-profit", aliases: ["charity", "ngo"] },
  {
    id: "government",
    label: "Government",
    aliases: ["public sector", "civic"],
  },
  { id: "sports", label: "Sports", aliases: ["teams", "athletes"] },
  {
    id: "social",
    label: "Social & community",
    aliases: ["community", "dating", "social network"],
  },
  {
    id: "recruiting",
    label: "Recruiting & HR",
    aliases: ["hr", "hiring", "jobs"],
  },
] as const;

export type DomainId = (typeof DOMAINS)[number]["id"];
export const DOMAIN_IDS = DOMAINS.map((d) => d.id) as [DomainId, ...DomainId[]];

// ---------- links ----------

export type LinkCheck =
  { ok: true; url: string } | { ok: false; message: string };

const LINK_MESSAGES = {
  empty: "Add a link or remove this one.",
  invalid: "That doesn't look like a web link.",
  email: "That's an email address, not a link.",
  scheme: "Use a web link that starts with https:// or http://.",
  credentials: "Remove the username, password or port from the link.",
  host: "Use a link with a domain name, like site.io.",
  long: `Keep links to ${WORK_LIMITS.linkLength} characters or fewer.`,
} as const;

const linkFailure = (reason: keyof typeof LINK_MESSAGES): LinkCheck => ({
  ok: false,
  message: LINK_MESSAGES[reason],
});

/** Drops punctuation that ends a sentence, keeping a ")" that closes a "(" in the link. */
function trimTrailing(value: string): string {
  let out = value;
  while (/[.,;:!?'"\])}>]$/.test(out)) {
    if (
      out.endsWith(")") &&
      (out.match(/\(/g)?.length ?? 0) >= (out.match(/\)/g)?.length ?? 0)
    )
      break;
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * Checks a link's format only; nothing here (or anywhere) ever requests it. Keeps http(s)
 * links with a domain name (no IP addresses), no username, password or port, and at most
 * 300 characters. Trailing punctuation is trimmed and a bare host gets "https://".
 * Returns the normalised URL.
 */
export function checkLink(input: string): LinkCheck {
  const candidate = trimTrailing(input.trim());
  if (!candidate) return linkFailure("empty");
  if (candidate.length > WORK_LIMITS.linkLength) return linkFailure("long");
  if (/\s/.test(candidate)) return linkFailure("invalid");
  if (/^[^/@:]+@[^/@]+\.[^/@]+$/.test(candidate)) return linkFailure("email");

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(candidate);
  let url: URL;
  try {
    url = new URL(hasScheme ? candidate : `https://${candidate}`);
  } catch {
    return linkFailure("invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return linkFailure("scheme");
  if (url.username || url.password || url.port)
    return linkFailure("credentials");
  // URL has already normalised IPv4 forms like 0x7f.1 to 127.0.0.1.
  const host = url.hostname;
  if (
    host.startsWith("[") ||
    /^\d+(\.\d+){3}$/.test(host) ||
    host.split(".").filter(Boolean).length < 2
  )
    return linkFailure("host");
  if (url.href.length > WORK_LIMITS.linkLength) return linkFailure("long");
  return { ok: true, url: url.href };
}

// ---------- field schemas ----------

type Mode = "draft" | "complete" | "suggestion";

const text = (max: number) =>
  z.string().trim().max(max, `Keep it to ${max} characters or fewer.`);

/** A list of ids from a fixed set, each once. */
const idList = <T extends z.ZodType<string>>(
  id: T,
  max: number,
  noun: string,
) =>
  z
    .array(id)
    .max(max, `Pick up to ${max} ${noun}.`)
    .refine((ids) => new Set(ids).size === ids.length, "Each one once.")
    .default([]);

const skillIds = idList(
  z.string().refine((id) => SKILL_BY_ID.has(id), "Unknown skill."),
  WORK_LIMITS.entrySkills,
  "skills",
);
const categories = idList(
  z.enum(CATEGORY_IDS, { error: "Pick a job type from the list." }),
  WORK_LIMITS.entryCategories,
  "job types",
);
const domains = idList(
  z.enum(DOMAIN_IDS, { error: "Pick a domain from the list." }),
  WORK_LIMITS.domains,
  "domains",
);

const year = z
  .number({ error: "Enter a year." })
  .int("Enter a year.")
  .min(1950, "Enter a year from 1950 on.")
  .max(2100, "Enter a year before 2100.");
const monthYear = z.strictObject({
  year,
  month: z
    .number()
    .int()
    .min(1, "Pick a month.")
    .max(12, "Pick a month.")
    .nullable()
    .default(null),
});
export type MonthYear = z.output<typeof monthYear>;

/** Outcome or highlight lines. Drafts may hold empty lines the user is still typing. */
const lines = (max: number, mode: Mode) =>
  z
    .array(
      mode === "draft"
        ? text(WORK_LIMITS.entrySummary)
        : text(WORK_LIMITS.entrySummary).min(
            1,
            "Write this line or remove it.",
          ),
    )
    .max(max, `Keep it to ${max} lines.`)
    .default([]);

const link = z.string().transform((value, ctx) => {
  const check = checkLink(value);
  if (check.ok) return check.url;
  ctx.addIssue({ code: "custom", message: check.message });
  return z.NEVER;
});
/** Drafts keep links as typed; complete steps and suggestions keep only links that pass checkLink. */
const links = (mode: Mode) =>
  z
    .array(mode === "draft" ? text(WORK_LIMITS.linkLength) : link)
    .max(WORK_LIMITS.links, `Add up to ${WORK_LIMITS.links} links.`)
    .default([]);

const title = (mode: Mode) =>
  mode === "draft"
    ? text(WORK_LIMITS.entryTitle).default("")
    : text(WORK_LIMITS.entryTitle).min(1, "Add a title.");

// ---------- entries ----------

// Fields shared by an entry in the step and a suggestion from the resume.
function projectFields(mode: Mode) {
  return {
    title: title(mode),
    summary:
      mode === "complete"
        ? text(WORK_LIMITS.entrySummary).min(1, "Add a one-line summary.")
        : text(WORK_LIMITS.entrySummary).default(""),
    role: z.enum(PROJECT_ROLES).default("unknown"),
    kind: z.enum(PROJECT_KINDS).default("unknown"),
    skills: skillIds,
    categories,
    domains,
    outcomes: lines(WORK_LIMITS.outcomes, mode),
    links: links(mode),
    year: year.nullable().default(null),
    namesRemoved: z.boolean().default(false),
  };
}

function roleFields(mode: Mode) {
  return {
    title: title(mode),
    organisation: text(WORK_LIMITS.organisation).nullable().default(null),
    organisationDescription:
      mode === "complete"
        ? text(WORK_LIMITS.orgDescription).min(
            1,
            "Describe the organisation, like “a fintech payments company”.",
          )
        : text(WORK_LIMITS.orgDescription).default(""),
    employmentType: z.enum(ROLE_EMPLOYMENT_TYPES).default("unknown"),
    start: monthYear.nullable().default(null),
    end: monthYear.nullable().default(null),
    current: z.boolean().default(false),
    summary: text(WORK_LIMITS.entrySummary).default(""),
    highlights: lines(WORK_LIMITS.highlights, mode),
    skills: skillIds,
    categories,
    domains,
    namesRemoved: z.boolean().default(false),
  };
}

// Only in the step: where an entry came from, and whether drafts may use it.
const entryExtras = {
  source: z.enum(ENTRY_SOURCES).default("manual"),
  hidden: z.boolean().default(false),
};

type RoleCore = {
  organisation: string | null;
  employmentType: RoleEmploymentType;
  start: MonthYear | null;
  end: MonthYear | null;
  current: boolean;
};

const monthIndex = (d: MonthYear, fallback: number) =>
  d.year * 12 + (d.month ?? fallback);

function endNotBeforeStart(r: RoleCore, ctx: z.RefinementCtx) {
  if (r.current || !r.start || !r.end) return;
  // A missing month can't make the range wrong: compare it as the most forgiving month.
  if (monthIndex(r.end, 12) < monthIndex(r.start, 1))
    ctx.addIssue({
      code: "custom",
      path: ["end"],
      message: "The end can't be before the start.",
    });
}

/** A current role has no end; freelance and contract roles keep no organisation. */
const normaliseRole = <T extends RoleCore>(r: T): T => ({
  ...r,
  organisation: ORGANISATION_FREE_TYPES.has(r.employmentType)
    ? null
    : r.organisation || null,
  end: r.current ? null : r.end,
});

export const projectEntry = (complete: boolean) =>
  z.strictObject({
    ...projectFields(complete ? "complete" : "draft"),
    ...entryExtras,
  });

export const roleEntry = (complete: boolean) =>
  z
    .strictObject({
      ...roleFields(complete ? "complete" : "draft"),
      ...entryExtras,
    })
    .superRefine(complete ? endNotBeforeStart : () => {})
    .transform(normaliseRole);

/** A project as the resume import suggests it: the entry fields without source and hidden. */
export const projectSuggestion = z.strictObject(projectFields("suggestion"));
/** A role as the resume import suggests it: the entry fields without source and hidden. */
export const experienceSuggestion = z
  .strictObject(roleFields("suggestion"))
  .transform(normaliseRole);

export type ProjectEntry = z.output<ReturnType<typeof projectEntry>>;
export type RoleEntry = z.output<ReturnType<typeof roleEntry>>;
export type ProjectSuggestion = z.output<typeof projectSuggestion>;
export type ExperienceSuggestion = z.output<typeof experienceSuggestion>;

// ---------- the step ----------

const workShape = (complete: boolean) =>
  z.strictObject({
    projects: z
      .array(projectEntry(complete))
      .max(WORK_LIMITS.projects, `Add up to ${WORK_LIMITS.projects} projects.`)
      .default([]),
    experience: z
      .array(roleEntry(complete))
      .max(WORK_LIMITS.roles, `Add up to ${WORK_LIMITS.roles} roles.`)
      .default([]),
    mentionEmployers: z.boolean().default(false),
  });

/** The "Projects & experience" step. Both lists may be empty, even to complete it. */
export const workSchemas = {
  draft: workShape(false),
  complete: workShape(true),
} as const;

export type WorkDraft = z.output<typeof workSchemas.draft>;
export type WorkData = z.output<typeof workSchemas.complete>;
