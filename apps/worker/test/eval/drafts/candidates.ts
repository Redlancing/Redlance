/**
 * The draft eval review queue: drafts worth a human look (`draft_eval_candidates`).
 *
 *   npm run eval:candidates -w @redlance/worker                  list the pending ones
 *   npm run eval:candidates -w @redlance/worker -- --add <id>    write a case file, mark `added`
 *   npm run eval:candidates -w @redlance/worker -- --skip <id>   mark `skipped`
 *
 * `--add` writes `cases/<case id>.json` with the post (usernames and emails masked), its
 * analysis, the closest synthetic profile and a starting `expect` list. Open the file, tidy the
 * `tags` and `expect` by hand, and check the text for anything private. Reads DATABASE_URL.
 */
import { existsSync, writeFileSync } from "node:fs";
import {
  draftEvalCandidates,
  drafts,
  jobPostAnalyses,
  jobPosts,
  type Database,
} from "@redlance/db";
import { and, asc, eq } from "drizzle-orm";
import { CASES_DIR, draftCaseSchema, type DraftCase } from "./cases";
import { caseAnalysis, profileFor, scrubText } from "./export-cases";

export type Candidate = {
  id: string;
  reason: string;
  reviewStatus: string;
  note: string | null;
  createdAt: Date;
  draftId: string;
  version: number;
  comment: string | null;
  dm: string | null;
  problems: { code: string; detail?: string }[] | null;
  post: { title: string; body: string; subreddit: string };
};

const candidateQuery = (db: Database) =>
  db
    .select({
      c: draftEvalCandidates,
      d: drafts,
      p: jobPosts,
      a: jobPostAnalyses,
    })
    .from(draftEvalCandidates)
    .innerJoin(drafts, eq(drafts.id, draftEvalCandidates.draftId))
    .innerJoin(jobPosts, eq(jobPosts.id, drafts.jobPostId))
    .innerJoin(jobPostAnalyses, eq(jobPostAnalyses.jobPostId, jobPosts.id));

const toCandidate = (r: {
  c: typeof draftEvalCandidates.$inferSelect;
  d: typeof drafts.$inferSelect;
  p: typeof jobPosts.$inferSelect;
}): Candidate => ({
  id: r.c.id,
  reason: r.c.reason,
  reviewStatus: r.c.reviewStatus,
  note: r.c.note,
  createdAt: r.c.createdAt,
  draftId: r.d.id,
  version: r.d.version,
  comment: r.d.comment,
  dm: r.d.dm,
  problems: r.d.problems,
  post: { title: r.p.title, body: r.p.body, subreddit: r.p.community },
});

/** Pending candidates, oldest first. */
export async function listCandidates(db: Database): Promise<Candidate[]> {
  const rows = await candidateQuery(db)
    .where(eq(draftEvalCandidates.reviewStatus, "pending"))
    .orderBy(asc(draftEvalCandidates.createdAt), asc(draftEvalCandidates.id));
  return rows.map(toCandidate);
}

const EXPECT_BY_REASON: Record<string, string> = {
  validator_failed_twice: "passes every validator without needing a retry",
  heavy_edit:
    "reads like something the freelancer would send with little editing",
  many_rewrites: "is right on the first draft: specific, plain and short",
  thumbs_down: "is specific to the post and sounds like a person",
};

/** Marks a pending candidate as skipped. Returns false when it isn't pending. */
export async function skipCandidate(
  db: Database,
  id: string,
): Promise<boolean> {
  const rows = await db
    .update(draftEvalCandidates)
    .set({ reviewStatus: "skipped" })
    .where(
      and(
        eq(draftEvalCandidates.id, id),
        eq(draftEvalCandidates.reviewStatus, "pending"),
      ),
    )
    .returning({ id: draftEvalCandidates.id });
  return rows.length > 0;
}

/**
 * Writes the case file for a pending candidate and marks it `added`. The profile is the
 * synthetic one closest to the post's job type (the user's real profile never leaves the
 * database). Throws if the candidate isn't pending or the case file already exists.
 */
export async function addCandidate(
  db: Database,
  id: string,
  opts: { dir?: URL } = {},
): Promise<{ caseId: string; file: URL; case: DraftCase }> {
  const dir = opts.dir ?? CASES_DIR;
  const [row] = await candidateQuery(db).where(eq(draftEvalCandidates.id, id));
  if (!row) throw new Error(`No candidate ${id}`);
  if (row.c.reviewStatus !== "pending")
    throw new Error(`Candidate ${id} is already ${row.c.reviewStatus}`);

  const analysis = caseAnalysis(row.a);
  const caseId = `cand-${row.c.reason.replace(/_/g, "-")}-${id.slice(-8).toLowerCase()}`;
  const file = new URL(`${caseId}.json`, dir);
  if (existsSync(file)) throw new Error(`${caseId}.json already exists`);
  const expect = [
    EXPECT_BY_REASON[row.c.reason] ??
      "is specific to the post and sounds like a person",
  ];
  if (analysis.applyInstructions)
    expect.push("follows the post's how-to-apply instructions");
  const parsed = draftCaseSchema.parse({
    id: caseId,
    tags: [],
    profileId: profileFor(analysis.categories[0] ?? "admin"),
    post: {
      title: scrubText(row.p.title),
      body: scrubText(row.p.body),
      subreddit: row.p.community,
    },
    analysis,
    expect,
  } satisfies DraftCase);
  writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n");
  await db
    .update(draftEvalCandidates)
    .set({ reviewStatus: "added", note: `case ${caseId}` })
    .where(eq(draftEvalCandidates.id, id));
  return { caseId, file, case: parsed };
}

export function formatCandidate(c: Candidate): string {
  return [
    `${c.id}  [${c.reason}]  draft v${c.version}  ${c.createdAt.toISOString().slice(0, 10)}`,
    `  r/${c.post.subreddit}: ${c.post.title}`,
    c.problems?.length
      ? `  problems: ${c.problems.map((p) => p.code).join(", ")}`
      : "",
    `  comment: ${c.comment ?? "(none)"}`,
    `  dm: ${(c.dm ?? "(none)").replace(/\n+/g, " / ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (apps/worker/.env.local)");
  const { createDb } = await import("@redlance/db");
  const { db, pool } = createDb(url, { max: 1 });
  try {
    const add = arg("add");
    const skip = arg("skip");
    if (add) {
      const r = await addCandidate(db, add);
      console.log(
        `Wrote ${r.file.pathname}\nEdit its tags and expect lines, then check the text for private details.`,
      );
    } else if (skip) {
      console.log(
        (await skipCandidate(db, skip))
          ? "Skipped."
          : "Not pending (or no such candidate).",
      );
    } else {
      const list = await listCandidates(db);
      console.log(
        list.length
          ? list.map(formatCandidate).join("\n\n")
          : "No pending candidates.",
      );
      if (list.length)
        console.log("\n--add <id> writes a case file; --skip <id> dismisses.");
    }
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
