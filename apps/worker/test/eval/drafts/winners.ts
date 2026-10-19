/**
 * Winning drafts -> the example library (docs/drafts/README.md §12).
 *
 *   npm run eval:winners -w @redlance/worker                    list winners to review
 *   npm run eval:winners -w @redlance/worker -- --promote <replyId>
 *
 * A winner is a sent DM that got a reply or a hire (a `replied` or `hired` status or outcome),
 * that the user barely edited (edit ratio <= 0.3), of at least 20 words, and not promoted yet.
 * `--promote` strips the private parts from the SENT text, masks facts the draft's evidence or the post back (`{project}`, `{number}`), checks it, and saves it to
 * `draft_examples` with `source = 'winning'`. The row id is `winning-<replyId>`, so promoting
 * twice is a no-op. `syncReferenceData` only deactivates `handwritten` rows, so it stays active.
 * Reads DATABASE_URL.
 */
import {
  findNumbers,
  maskNumbers,
  normalise,
  scrubOrganisations,
  validateDraft,
  wordCount,
  type Evidence,
  type Problem,
} from "@redlance/core";
import {
  draftExamples,
  drafts,
  jobPostAnalyses,
  jobPosts,
  outcomes,
  profileExperience,
  profiles,
  replies,
  type Database,
} from "@redlance/db";
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { loadCases, type LoadedCases } from "./cases";
import { scrubText } from "./export-cases";

export const WINNER_MAX_EDIT_RATIO = 0.3;
export const WINNER_MIN_WORDS = 20;
const WINNING_STATUSES = ["replied", "hired"] as const;
export const exampleIdFor = (replyId: string) => `winning-${replyId}`;

export type Winner = {
  replyId: string;
  userId: string;
  draftId: string;
  status: string;
  editRatio: number;
  words: number;
  sentText: string;
  sentAt: Date;
  jobType: string;
  styleTags: string[];
  post: { title: string; body: string };
  /** The draft's stored evidence (core `Evidence`), used only to mask facts. */
  evidence: Record<string, unknown> | null;
};

/** Winning replies, newest first. */
export async function listWinners(db: Database): Promise<Winner[]> {
  const rows = await db
    .select({ r: replies, d: drafts, p: jobPosts, a: jobPostAnalyses })
    .from(replies)
    .innerJoin(drafts, eq(drafts.id, replies.draftId))
    .innerJoin(jobPosts, eq(jobPosts.id, replies.jobPostId))
    .leftJoin(jobPostAnalyses, eq(jobPostAnalyses.jobPostId, jobPosts.id))
    .where(
      and(
        eq(replies.kind, "dm"),
        lte(replies.editRatio, WINNER_MAX_EDIT_RATIO),
        or(
          inArray(replies.status, [...WINNING_STATUSES]),
          sql`exists (select 1 from ${outcomes} where ${outcomes.replyId} = ${replies.id} and ${outcomes.type} in ('replied', 'hired'))`,
        ),
        sql`not exists (select 1 from ${draftExamples} where ${draftExamples.id} = 'winning-' || ${replies.id}::text)`,
      ),
    )
    .orderBy(sql`${replies.sentAt} desc`, asc(replies.id));
  return rows
    .map(({ r, d, p, a }): Winner => ({
      replyId: r.id,
      userId: r.userId,
      draftId: d.id,
      status: r.status,
      editRatio: r.editRatio ?? 0,
      words: wordCount(r.sentText),
      sentText: r.sentText,
      sentAt: r.sentAt,
      jobType: a?.categories[0] ?? "general",
      styleTags: d.styleTags ?? [],
      post: { title: p.title, body: p.body },
      evidence: d.evidence ?? null,
    }))
    .filter((w) => w.words >= WINNER_MIN_WORDS);
}

// ---- Stripping ---------------------------------------------------------------------------------

const URL_RE =
  /https?:\/\/[^\s<>"'`)\]]+|(?<![\p{L}\p{N}_/.@-])(?:www\.)?github\.com\/[^\s<>"'`)\]]+/giu;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type PrivateParts = {
  displayName: string;
  githubUsername: string | null;
  organisations: { organisation: string | null; description: string }[];
};

/**
 * The sent text with the user's private parts removed: employers (as their description), the
 * display name (with an "I'm Maya." introduction), links (all become `{link}`), Reddit
 * usernames, emails and phone-like numbers.
 */
export function stripPrivate(text: string, who: PrivateParts): string {
  let out = scrubOrganisations(text, who.organisations);
  out = out.replace(URL_RE, "{link}");
  if (who.githubUsername)
    out = out.replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}])@?${escapeRe(who.githubUsername)}(?![\\p{L}\\p{N}])`,
        "giu",
      ),
      "",
    );
  out = scrubText(out)
    .replace(/\/?\bu\/\[user\]/g, "")
    .replace(/\[email\]/g, "")
    .replace(/(?<![\w.])\+?\d[\d\s().-]{6,}\d(?![\w])/g, "");
  const nameParts = who.displayName
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .sort((a, b) => b.length - a.length);
  const nameAlt = [who.displayName, ...nameParts]
    .filter(Boolean)
    .map(escapeRe)
    .join("|");
  if (nameAlt) {
    out = out.replace(
      new RegExp(
        `(?:\\b(?:i'm|i am|my name is|this is|it's)\\s+)(?:${nameAlt})\\b[.,!]?\\s*`,
        "giu",
      ),
      "",
    );
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])(?:${nameAlt})(?![\\p{L}\\p{N}])`, "giu"),
      "",
    );
  }
  return out
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Replaces what the draft's own evidence and the post back, so the example carries the shape of
 * a good message and none of one user's facts: the cited project (and role) title becomes
 * `{project}`, and any claim-like number backed by that evidence or the post (a result, a year,
 * a budget) becomes `{number}`. The evidence is used only here, never to validate: an example
 * still has to pass `validateDraft` against an empty evidence.
 */
export function maskBackedFacts(
  text: string,
  evidence: Record<string, unknown> | null,
  postText: string,
): string {
  const ev = evidence ?? {};
  const titles = [
    str((ev.project as { title?: unknown } | null)?.title),
    str((ev.role as { title?: unknown } | null)?.title),
  ]
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const t of titles)
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`, "giu"),
      "{project}",
    );
  const backed = new Set(findNumbers(`${str(ev.evidenceText)}\n${postText}`));
  return maskNumbers(out, (v) => backed.has(v), "{number}");
}

const EMPTY_EVIDENCE: Evidence = {
  project: null,
  role: null,
  skills: [],
  allowedLinks: [],
  rateNote: { mention: false },
  availability: null,
  redFlags: [],
  broad: false,
  employerNamesAllowed: false,
  organisationNames: [],
  evidenceText: "",
  summary: { projectTitle: null, roleTitle: null, skills: [] },
  citedProjectIds: [],
};

export class PromoteError extends Error {
  constructor(
    readonly code: "NOT_A_WINNER" | "CHECK_FAILED" | "SAME_AS_EVAL_CASE",
    message: string,
    readonly problems: Problem[] = [],
  ) {
    super(message);
    this.name = "PromoteError";
  }
}

/** Is this text (or a long part of it) a copy of an eval case's post? */
function copiesAnEvalCase(text: string, cases: LoadedCases): boolean {
  const t = normalise(text);
  return cases.drafts.some((c) =>
    [c.post.title, c.post.body].some((s) => {
      const n = normalise(s);
      return (
        n.length > 0 &&
        (t === n || (n.length >= 40 && (t.includes(n) || n.includes(t))))
      );
    }),
  );
}

export type PromoteResult = {
  id: string;
  created: boolean;
  text: string;
  jobType: string;
  style: string;
};

/**
 * Turns one winner into a library example. Throws `PromoteError` when the reply is not a winner,
 * when the stripped text fails `validateDraft` against an empty evidence (an unknown link, an
 * unsupported number, a banned phrase...), or when it equals an eval case. Promoting the same
 * reply again returns `created: false`.
 */
export async function promoteWinner(
  db: Database,
  replyId: string,
  opts: { cases?: LoadedCases } = {},
): Promise<PromoteResult> {
  const id = exampleIdFor(replyId);
  const [done] = await db
    .select()
    .from(draftExamples)
    .where(eq(draftExamples.id, id));
  if (done)
    return {
      id,
      created: false,
      text: done.text,
      jobType: done.jobType,
      style: done.style,
    };

  const winner = (await listWinners(db)).find((w) => w.replyId === replyId);
  if (!winner)
    throw new PromoteError(
      "NOT_A_WINNER",
      "Not a winner: it needs a sent DM with a reply or hire, an edit ratio of 0.3 or less, and 20+ words",
    );

  const [profile] = await db
    .select({
      displayName: profiles.displayName,
      githubUsername: profiles.githubUsername,
    })
    .from(profiles)
    .where(eq(profiles.userId, winner.userId));
  const roles = await db
    .select({
      organisation: profileExperience.organisation,
      description: profileExperience.organisationDescription,
    })
    .from(profileExperience)
    .where(eq(profileExperience.userId, winner.userId));
  const text = maskBackedFacts(
    stripPrivate(winner.sentText, {
      displayName: profile?.displayName ?? "",
      githubUsername: profile?.githubUsername ?? null,
      organisations: roles,
    }),
    winner.evidence,
    `${winner.post.title}\n${winner.post.body}`,
  );

  const problems = validateDraft({ comment: "", dm: text }, EMPTY_EVIDENCE, {
    postText: `${winner.post.title}\n${winner.post.body}`,
    target: { dmMin: WINNER_MIN_WORDS, dmMax: 400 },
  });
  if (problems.length)
    throw new PromoteError(
      "CHECK_FAILED",
      `The stripped text fails the checks: ${problems.map((p) => p.code + (p.detail ? ` (${p.detail})` : "")).join(", ")}`,
      problems,
    );
  if (copiesAnEvalCase(text, opts.cases ?? loadCases()))
    throw new PromoteError(
      "SAME_AS_EVAL_CASE",
      "The text is the same as an eval case",
    );

  const style = winner.styleTags.length
    ? winner.styleTags.join(", ")
    : "problem_first";
  const excerpt = scrubText(`${winner.post.title}\n${winner.post.body}`)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  const inserted = await db
    .insert(draftExamples)
    .values({
      id,
      jobType: winner.jobType,
      channel: "dm",
      style,
      postExcerpt: excerpt,
      text,
      source: "winning",
      active: true,
    })
    .onConflictDoNothing()
    .returning({ id: draftExamples.id });
  return {
    id,
    created: inserted.length > 0,
    text,
    jobType: winner.jobType,
    style,
  };
}

export function formatWinner(w: Winner): string {
  return [
    `${w.replyId}  [${w.status}]  edit ${w.editRatio.toFixed(2)}  ${w.words} words  ${w.jobType}  ${w.sentAt.toISOString().slice(0, 10)}`,
    `  post: ${w.post.title}`,
    `  sent: ${w.sentText.replace(/\n+/g, " / ")}`,
  ].join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--promote");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (apps/worker/.env.local)");
  const { createDb } = await import("@redlance/db");
  const { db, pool } = createDb(url, { max: 1 });
  try {
    if (i >= 0) {
      const replyId = argv[i + 1];
      if (!replyId) throw new Error("--promote needs a reply id");
      const r = await promoteWinner(db, replyId);
      console.log(
        `${r.created ? "Promoted" : "Already promoted"} as ${r.id} (${r.jobType}, ${r.style}):\n\n${r.text}`,
      );
    } else {
      const list = await listWinners(db);
      console.log(
        list.length
          ? list.map(formatWinner).join("\n\n")
          : "No winning drafts yet.",
      );
      if (list.length)
        console.log(
          "\n--promote <replyId> strips the names and link and saves it as an example.",
        );
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
