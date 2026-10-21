import "server-only";
import {
  STEP_SCHEMAS,
  projectEntry as projectEntrySchema,
  roleEntry as roleEntrySchema,
  toFieldErrors,
  type ProjectEntry,
  type RoleEntry,
} from "@redlance/core";
import {
  profileChanges,
  profileExperience,
  profileProjects,
  profileSkills,
  profiles,
} from "@redlance/db";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  PROFILE_EDIT_WINDOW_DAYS,
  SECTION_STEP,
  computeAllowance,
  sameSection,
  stableJson,
  withoutNamesRemoved,
  type EditAllowance,
  type ProfileSection,
  type ProfileSections,
  type SectionData,
} from "@/lib/profile-edit";
import { getDb } from "../db";
import { ApiError } from "../errors";

// Editing a finished profile (docs/onboarding/profile-edit.md). Each save is one section, checked
// with the onboarding step's complete schema. A save that changes something bumps
// profiles.profile_version and writes a profile_changes row; at most 5 in any 7 days.
// It never requests a re-match: posts already matched keep their scores, new posts use the new
// profile (decided 2026-10-20).

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;
type ProfileRow = typeof profiles.$inferSelect;

export type ProfileEditState = {
  /** profiles.profile_version: the expectedVersion for the next save. */
  version: number;
  timeZone: string;
  sections: ProfileSections;
  allowance: EditAllowance;
};

export type SaveSectionInput = { data: unknown; expectedVersion: number };

export type SaveSectionResult<K extends ProfileSection = ProfileSection> = {
  /** False for a save that matched what was stored: no version bump, not counted. */
  changed: boolean;
  version: number;
  data: SectionData<K>;
  allowance: EditAllowance;
};

// ---------- reading ----------

type ProjectRow = typeof profileProjects.$inferSelect;
type RoleRow = typeof profileExperience.$inferSelect;

function projectFromRow(r: ProjectRow): ProjectEntry {
  return {
    title: r.title,
    summary: r.summary,
    role: r.role,
    kind: r.kind,
    skills: r.skillIds,
    categories: r.categories as ProjectEntry["categories"],
    domains: r.domains as ProjectEntry["domains"],
    outcomes: r.outcomes,
    links: r.links,
    year: r.year,
    namesRemoved: false,
    source: r.source,
    hidden: r.hidden,
  };
}

function roleFromRow(r: RoleRow): RoleEntry {
  return {
    title: r.title,
    organisation: r.organisation,
    organisationDescription: r.organisationDescription,
    employmentType: r.employmentType,
    start:
      r.startYear === null ? null : { year: r.startYear, month: r.startMonth },
    end: r.endYear === null ? null : { year: r.endYear, month: r.endMonth },
    current: r.isCurrent,
    summary: r.summary,
    highlights: r.highlights,
    skills: r.skillIds,
    categories: r.categories as RoleEntry["categories"],
    domains: r.domains as RoleEntry["domains"],
    namesRemoved: false,
    source: r.source,
    hidden: r.hidden,
  };
}

async function readSection<K extends ProfileSection>(
  db: Executor,
  profile: ProfileRow,
  section: K,
): Promise<SectionData<K>> {
  const userId = profile.userId;
  let data: unknown;
  switch (section) {
    case "basics":
      data = {
        displayName: profile.displayName,
        headline: profile.headline,
        categories: profile.categories,
        experienceLevel: profile.experienceLevel,
        country: profile.country,
        timeZone: profile.timeZone,
      };
      break;
    case "rates":
      data = {
        minRate: profile.minRateMinor / 100,
        currency: profile.currency,
        rateType: profile.rateType,
        remoteOnly: profile.remoteOnly,
      };
      break;
    case "github":
      data = { githubUsername: profile.githubUsername };
      break;
    case "skills": {
      const rows = await db
        .select({
          id: profileSkills.skillId,
          level: profileSkills.level,
          source: profileSkills.source,
        })
        .from(profileSkills)
        .where(eq(profileSkills.userId, userId))
        .orderBy(asc(profileSkills.createdAt), asc(profileSkills.skillId));
      data = { skills: rows };
      break;
    }
    case "work": {
      const projects = await db
        .select()
        .from(profileProjects)
        .where(eq(profileProjects.userId, userId))
        .orderBy(asc(profileProjects.position));
      const roles = await db
        .select()
        .from(profileExperience)
        .where(eq(profileExperience.userId, userId))
        .orderBy(asc(profileExperience.position));
      data = {
        projects: projects.map(projectFromRow),
        experience: roles.map(roleFromRow),
        mentionEmployers: profile.mentionEmployers,
      };
      break;
    }
  }
  return data as SectionData<K>;
}

/**
 * The stored section in the schema's normal form (links normalised, defaults filled), so it
 * compares equal to the same data sent back. Falls back to the raw form if it no longer passes
 * (e.g. a limit was tightened); then any save counts as a change.
 */
function normalised(section: ProfileSection, data: unknown): unknown {
  const parsed = STEP_SCHEMAS[SECTION_STEP[section]].complete.safeParse(data);
  return parsed.success ? parsed.data : data;
}

async function loadAllowance(
  db: Executor,
  userId: string,
): Promise<EditAllowance> {
  // The database clock decides the window, as it does for created_at.
  const now = await db.execute<{ ms: number | string }>(
    sql`select (extract(epoch from now()) * 1000)::float8 as ms`,
  );
  const rows = await db
    .select({ at: profileChanges.createdAt })
    .from(profileChanges)
    .where(
      and(
        eq(profileChanges.userId, userId),
        gt(
          profileChanges.createdAt,
          sql`now() - make_interval(days => ${PROFILE_EDIT_WINDOW_DAYS})`,
        ),
      ),
    );
  return computeAllowance(
    rows.map((r) => r.at),
    new Date(Number(now.rows[0]!.ms)),
  );
}

/** Everything `/profile` shows, or null when the user hasn't finished onboarding. */
export async function getProfileForEdit(
  userId: string,
  db: Executor = getDb(),
): Promise<ProfileEditState | null> {
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (!profile) return null;
  // One query at a time: a transaction client can't run them in parallel.
  const sections = {} as Record<ProfileSection, unknown>;
  for (const section of [
    "basics",
    "skills",
    "work",
    "rates",
    "github",
  ] as const)
    sections[section] = normalised(
      section,
      await readSection(db, profile, section),
    );
  return {
    version: profile.profileVersion,
    timeZone: profile.timeZone,
    sections: sections as ProfileSections,
    allowance: await loadAllowance(db, userId),
  };
}

// ---------- writing ----------

async function writeSkills(
  tx: Tx,
  userId: string,
  data: SectionData<"skills">,
) {
  await tx.delete(profileSkills).where(eq(profileSkills.userId, userId));
  if (data.skills.length)
    await tx.insert(profileSkills).values(
      data.skills.map((s) => ({
        userId,
        skillId: s.id,
        level: s.level,
        source: s.source,
      })),
    );
}

const projectValues = (p: ProjectEntry) => ({
  title: p.title,
  summary: p.summary,
  role: p.role,
  kind: p.kind,
  skillIds: p.skills,
  categories: p.categories,
  domains: p.domains,
  outcomes: p.outcomes,
  links: p.links,
  year: p.year,
  source: p.source,
  hidden: p.hidden,
});

const roleValues = (r: RoleEntry) => ({
  title: r.title,
  summary: r.summary,
  organisation: r.organisation,
  organisationDescription: r.organisationDescription,
  employmentType: r.employmentType,
  startYear: r.start?.year ?? null,
  startMonth: r.start?.month ?? null,
  endYear: r.end?.year ?? null,
  endMonth: r.end?.month ?? null,
  isCurrent: r.current,
  highlights: r.highlights,
  skillIds: r.skills,
  categories: r.categories,
  domains: r.domains,
  source: r.source,
  hidden: r.hidden,
});

const entryKey = (entry: object) => stableJson(withoutNamesRemoved(entry));

/** A stored entry's key, in the schema's normal form so it matches the same entry sent back. */
function rowKey<T extends object>(
  entry: T,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } },
): string {
  const parsed = schema.safeParse(entry);
  return entryKey((parsed.success ? parsed.data : entry) as object);
}
const projectKey = (r: ProjectRow) =>
  rowKey(projectFromRow(r), projectEntrySchema(true));
const roleKey = (r: RoleRow) => rowKey(roleFromRow(r), roleEntrySchema(true));

/**
 * Plans a list rewrite that keeps the row (and its id) of every entry that is unchanged, so
 * `matches.best_project_id` / `best_role_id` keep pointing at it. Changed entries are new rows.
 */
export function planEntries<Row extends { id: string; position: number }>(
  existing: readonly Row[],
  existingKey: (row: Row) => string,
  wanted: readonly object[],
): {
  keep: { id: string; position: number; moved: boolean }[];
  insert: { index: number }[];
  remove: string[];
} {
  const pool = new Map<string, Row[]>();
  for (const row of existing) {
    const key = existingKey(row);
    pool.set(key, [...(pool.get(key) ?? []), row]);
  }
  const keep: { id: string; position: number; moved: boolean }[] = [];
  const insert: { index: number }[] = [];
  wanted.forEach((entry, index) => {
    const row = pool.get(entryKey(entry))?.shift();
    if (row)
      keep.push({ id: row.id, position: index, moved: row.position !== index });
    else insert.push({ index });
  });
  const kept = new Set(keep.map((k) => k.id));
  return {
    keep,
    insert,
    remove: existing.filter((r) => !kept.has(r.id)).map((r) => r.id),
  };
}

async function writeWork(tx: Tx, userId: string, data: SectionData<"work">) {
  const projects = data.projects as ProjectEntry[];
  const roles = data.experience as RoleEntry[];

  const oldProjects = await tx
    .select()
    .from(profileProjects)
    .where(eq(profileProjects.userId, userId));
  const p = planEntries(oldProjects, projectKey, projects);
  if (p.remove.length)
    await tx
      .delete(profileProjects)
      .where(inArray(profileProjects.id, p.remove));
  for (const k of p.keep.filter((k) => k.moved))
    await tx
      .update(profileProjects)
      .set({ position: k.position, updatedAt: sql`now()` })
      .where(eq(profileProjects.id, k.id));
  if (p.insert.length)
    await tx.insert(profileProjects).values(
      p.insert.map(({ index }) => ({
        userId,
        position: index,
        ...projectValues(projects[index]!),
      })),
    );

  const oldRoles = await tx
    .select()
    .from(profileExperience)
    .where(eq(profileExperience.userId, userId));
  const r = planEntries(oldRoles, roleKey, roles);
  if (r.remove.length)
    await tx
      .delete(profileExperience)
      .where(inArray(profileExperience.id, r.remove));
  for (const k of r.keep.filter((k) => k.moved))
    await tx
      .update(profileExperience)
      .set({ position: k.position, updatedAt: sql`now()` })
      .where(eq(profileExperience.id, k.id));
  if (r.insert.length)
    await tx.insert(profileExperience).values(
      r.insert.map(({ index }) => ({
        userId,
        position: index,
        ...roleValues(roles[index]!),
      })),
    );

  await tx
    .update(profiles)
    .set({ mentionEmployers: data.mentionEmployers })
    .where(eq(profiles.userId, userId));
}

async function writeSection(
  tx: Tx,
  userId: string,
  section: ProfileSection,
  data: unknown,
) {
  switch (section) {
    case "basics": {
      const v = data as SectionData<"basics">;
      await tx
        .update(profiles)
        .set({
          displayName: v.displayName,
          headline: v.headline,
          categories: v.categories,
          experienceLevel: v.experienceLevel!,
          country: v.country!,
          timeZone: v.timeZone!,
        })
        .where(eq(profiles.userId, userId));
      return;
    }
    case "rates": {
      const v = data as SectionData<"rates">;
      await tx
        .update(profiles)
        .set({
          minRateMinor: Math.round(v.minRate! * 100),
          currency: v.currency!,
          rateType: v.rateType!,
          remoteOnly: v.remoteOnly,
        })
        .where(eq(profiles.userId, userId));
      return;
    }
    case "github": {
      const v = data as SectionData<"github">;
      await tx
        .update(profiles)
        .set({ githubUsername: v.githubUsername })
        .where(eq(profiles.userId, userId));
      return;
    }
    case "skills":
      return writeSkills(tx, userId, data as SectionData<"skills">);
    case "work":
      return writeWork(tx, userId, data as SectionData<"work">);
  }
}

function limitReached(allowance: EditAllowance): ApiError {
  const seconds = allowance.nextFreeAt
    ? Math.max(
        1,
        Math.ceil(
          (new Date(allowance.nextFreeAt).getTime() - Date.now()) / 1000,
        ),
      )
    : undefined;
  return new ApiError(
    "PROFILE_EDIT_LIMIT",
    `You've used all ${allowance.limit} profile changes for this week.`,
    { limit: allowance.limit, nextFreeAt: allowance.nextFreeAt },
    seconds === undefined ? undefined : { "Retry-After": String(seconds) },
  );
}

/**
 * Saves one section of a finished profile, in one transaction:
 * lock the profile row → check the data (400) → check expectedVersion (409) → unchanged? return
 * without counting → 5 changes in 7 days? refuse (429) → write, bump profile_version, record it.
 * The row lock makes concurrent saves of one user take turns, so the count can't be raced.
 */
export async function saveProfileSection<K extends ProfileSection>(
  userId: string,
  section: K,
  input: SaveSectionInput,
): Promise<SaveSectionResult<K>> {
  return getDb().transaction(async (tx) => {
    const [profile] = await tx
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .for("update");
    if (!profile) throw new ApiError("NOT_FOUND", "Set up your profile first.");

    const parsed = STEP_SCHEMAS[SECTION_STEP[section]].complete.safeParse(
      input.data,
    );
    if (!parsed.success)
      throw new ApiError(
        "INVALID_INPUT",
        "Some fields are invalid.",
        toFieldErrors(parsed.error, "data"),
      );
    const data = parsed.data as SectionData<K>;

    if (profile.profileVersion !== input.expectedVersion)
      throw new ApiError(
        "VERSION_CONFLICT",
        "Your profile was changed somewhere else. Reload to see the latest version.",
        { version: profile.profileVersion },
      );

    const current = normalised(
      section,
      await readSection(tx, profile, section),
    );
    if (sameSection(section, current, data))
      return {
        changed: false,
        version: profile.profileVersion,
        data,
        allowance: await loadAllowance(tx, userId),
      };

    const before = await loadAllowance(tx, userId);
    if (before.remaining === 0) throw limitReached(before);

    await writeSection(tx, userId, section, data);
    // No requestRematch here: an edit only affects posts matched from now on.
    const [bumped] = await tx
      .update(profiles)
      .set({
        profileVersion: sql`${profiles.profileVersion} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(profiles.userId, userId))
      .returning({ version: profiles.profileVersion });
    const version = bumped!.version;
    await tx
      .insert(profileChanges)
      .values({ userId, section, profileVersion: version });

    return {
      changed: true,
      version,
      data,
      allowance: await loadAllowance(tx, userId),
    };
  });
}
