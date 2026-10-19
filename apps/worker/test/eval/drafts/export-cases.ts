/**
 * Exports posts and their analyses from a database into draft-eval case files, so new real cases
 * can be added by hand. Read-only: one `READ ONLY` transaction of SELECTs. The author is never
 * selected, and Reddit usernames and emails inside the text are masked.
 *
 *   npm run eval:export-cases -w @redlance/worker -- [--limit=40] [--category=video] [--out=<dir>]
 *
 * Reads DATABASE_URL (apps/worker/.env.local). Writes `<out>/<id>.json` (default: `exported/`
 * next to this file, which the case loader ignores). Fill in `profileId`, `tags` and `expect`
 * by hand, check the text for anything private, then move the file into `cases/`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { jobPostAnalyses, jobPosts, type Database } from "@redlance/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { PROFILES } from "./profiles";
import type { CaseAnalysis } from "./cases";

export type ExportedCase = {
  id: string;
  tags: string[];
  profileId: string;
  post: { title: string; body: string; subreddit: string };
  analysis: CaseAnalysis;
  expect: string[];
};

export type ExportOptions = {
  limit?: number;
  /** Only posts in this category (the first one listed by the analyser). */
  category?: string;
};

/** The synthetic profile closest to a post's main category. */
const PROFILE_FOR_CATEGORY: Record<string, string> = {
  development: "web-dev",
  video: "video-editor",
  audio: "video-editor",
  design: "junior-designer",
  art: "junior-designer",
  writing: "senior-writer",
};
export const profileFor = (category: string): string => {
  const id = PROFILE_FOR_CATEGORY[category] ?? "broad-generalist";
  return PROFILES.some((p) => p.id === id) ? id : "broad-generalist";
};

/** Masks Reddit usernames (`u/name`, `/u/name`) and email addresses. */
export function scrubText(text: string): string {
  return text
    .replace(/\/?\bu\/[A-Za-z0-9_-]{3,20}/g, "u/[user]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
}

/** A stored analysis row in the case file's shape (text scrubbed of usernames and emails). */
export function caseAnalysis(
  a: typeof jobPostAnalyses.$inferSelect,
): CaseAnalysis {
  return {
    kind: a.kind,
    employmentType: a.employmentType,
    payType: a.payType,
    categories: a.categories as CaseAnalysis["categories"],
    skillIds: a.skillIds,
    budgetMin: a.budgetMin,
    budgetMax: a.budgetMax,
    currency: a.currency,
    budgetUnit: a.budgetUnit,
    remote: a.remote,
    location: a.location,
    deadline: a.deadline,
    redFlags: a.redFlags as CaseAnalysis["redFlags"],
    summary: scrubText(a.summary),
    applyInstructions: a.applyInstructions
      ? scrubText(a.applyInstructions)
      : null,
  };
}

export async function exportCases(
  db: Database,
  opts: ExportOptions = {},
): Promise<ExportedCase[]> {
  const limit = opts.limit ?? 40;
  return db.transaction(
    async (tx) => {
      // The author column is deliberately not selected.
      const rows = await tx
        .select({
          title: jobPosts.title,
          body: jobPosts.body,
          community: jobPosts.community,
          analysis: jobPostAnalyses,
        })
        .from(jobPosts)
        .innerJoin(jobPostAnalyses, eq(jobPostAnalyses.jobPostId, jobPosts.id))
        .where(
          and(
            eq(jobPostAnalyses.kind, "hiring"),
            isNull(jobPosts.duplicateOf),
            opts.category
              ? sql`${jobPostAnalyses.categories}[1] = ${opts.category}`
              : undefined,
          ),
        )
        .orderBy(desc(jobPosts.postedAt))
        .limit(limit);
      return rows.map((r, i): ExportedCase => {
        const a = r.analysis;
        const category = a.categories[0] ?? "admin";
        return {
          id: `export-${String(i + 1).padStart(2, "0")}-${category}`,
          tags: [],
          profileId: profileFor(category),
          post: {
            title: scrubText(r.title),
            body: scrubText(r.body),
            subreddit: r.community,
          },
          analysis: caseAnalysis(a),
          expect: [],
        };
      });
    },
    { accessMode: "read only" },
  );
}

export function writeExportedCases(cases: ExportedCase[], dir: URL): void {
  mkdirSync(dir, { recursive: true });
  for (const c of cases)
    writeFileSync(
      new URL(`${c.id}.json`, dir),
      JSON.stringify(c, null, 2) + "\n",
    );
}

async function main() {
  const arg = (name: string) =>
    process.argv
      .find((a) => a.startsWith(`--${name}=`))
      ?.slice(name.length + 3);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (apps/worker/.env.local)");
  const { createDb } = await import("@redlance/db");
  const { db, pool } = createDb(url, { max: 1 });
  try {
    const cases = await exportCases(db, {
      limit: arg("limit") ? Number(arg("limit")) : undefined,
      category: arg("category"),
    });
    const out = arg("out")
      ? new URL(`file://${arg("out")!.replace(/\/?$/, "/")}`)
      : new URL("./exported/", import.meta.url);
    writeExportedCases(cases, out);
    console.log(`Exported ${cases.length} case(s) to ${out.pathname}`);
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  void main();
}
