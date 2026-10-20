import {
  MAX_VERSIONS,
  TASK_CREDITS,
  taskForRewrite,
  type RewriteOption,
} from "@redlance/core";
import { setBounded } from "@/lib/bounded-map";
import type { DraftView } from "@/server/drafts";

// Pure helpers for the draft composer, tested without a DOM.

export type ReplyKind = "comment" | "dm";

export const isWorking = (d: Pick<DraftView, "status">) =>
  d.status === "pending" || d.status === "running";

/** Adds or replaces a version, keeping version order. Failed versions are dropped. */
export function upsertVersion(
  versions: DraftView[],
  view: DraftView,
): DraftView[] {
  const rest = versions.filter((v) => v.id !== view.id);
  if (view.status === "failed") return rest;
  return [...rest, view].sort((a, b) => a.version - b.version);
}

const STATUS_RANK: Record<DraftView["status"], number> = {
  pending: 0,
  running: 1,
  done: 2,
  failed: 2,
};

/**
 * Combines two lists of versions of one match, for server data that may be older than what this
 * browser already knows (a cached page). By id the further-along status wins (a version known
 * locally as done is never pushed back to running), on a tie the second list wins, and a
 * version missing from the older list stays. Failed versions are dropped, like `upsertVersion`.
 */
export function mergeVersions(
  known: DraftView[],
  incoming: DraftView[],
): DraftView[] {
  const byId = new Map<string, DraftView>();
  for (const v of [...known, ...incoming]) {
    const have = byId.get(v.id);
    if (!have || STATUS_RANK[v.status] >= STATUS_RANK[have.status])
      byId.set(v.id, v);
  }
  return [...byId.values()]
    .filter((v) => v.status !== "failed")
    .sort((a, b) => a.version - b.version);
}

/**
 * A stand-in for a draft the server just accepted, until the first poll brings the real row. It
 * goes into the versions (and so into the per-match memory) at once: leaving the match before
 * that poll and coming back to a cached page must still show a draft being written, not offer
 * "Draft reply" again.
 */
export function pendingFirstDraft(
  matchId: string,
  draftId: string,
  createdAt: string,
): DraftView {
  return {
    id: draftId,
    matchId,
    status: "pending",
    version: 1,
    kind: "draft",
    option: null,
    instruction: null,
    comment: null,
    dm: null,
    warning: false,
    problems: [],
    evidenceSummary: null,
    applyInstructions: null,
    redFlags: [],
    creditsCharged: TASK_CREDITS.draft,
    error: null,
    createdAt,
  };
}

/** What was marked sent: a union, because a reply can't be un-sent. */
export function mergeSent(
  known: Partial<Record<ReplyKind, boolean>>,
  kinds: readonly ReplyKind[],
): Partial<Record<ReplyKind, boolean>> {
  return { ...known, ...Object.fromEntries(kinds.map((k) => [k, true])) };
}

/**
 * Whether the "Draft reply" button (7 credits) may show. Not before the server has confirmed
 * what exists for this match, and not when a version exists or is being written: a cached page
 * with no drafts must never invite a second, paid draft.
 */
export function canOfferDraft(s: {
  confirmed: boolean;
  versions: DraftView[];
  writing: boolean;
}): boolean {
  return s.confirmed && !s.writing && s.versions.length === 0;
}

/** Where the composer is in asking the server what exists for this match (versions, sent). */
export type ServerCheck = "pending" | "failed" | "done";

/**
 * Whether what the composer shows is confirmed: the page brought fresh versions, or the
 * server has answered since. A failed check is not a confirmation (the user retries).
 */
export function isConfirmed(s: {
  /** The page brought versions with it. */
  pageVersions: boolean;
  /** The page's data is old and must be checked. */
  revalidate: boolean;
  check: ServerCheck;
}): boolean {
  return (s.pageVersions && !s.revalidate) || s.check === "done";
}

/** Why rewrites and "I posted this" are off, or null when they're allowed. */
export function actionsBlocked(s: {
  confirmed: boolean;
  check: ServerCheck;
  versions: DraftView[];
}): string | null {
  if (s.confirmed) return rewriteBlocked(s.versions);
  return s.check === "failed"
    ? "Couldn't check for newer versions."
    : "Checking for newer versions…";
}

/** What the composer remembers per match for the life of the tab. */
export type DraftMemory = {
  edits: Edits;
  sent: Partial<Record<ReplyKind, boolean>>;
  /** The newest versions this browser has seen (a cached page can carry older ones). */
  versions: DraftView[];
};

/** How many matches the composer remembers; the oldest go first. */
export const MAX_REMEMBERED_MATCHES = 200;

/**
 * Remembers part of a match's composer state. The match written to becomes the newest entry;
 * above `max` the oldest go, except those with edits not marked sent (losing them would lose
 * the user's words; closing the tab with them asks first).
 */
export function rememberDraftState(
  memory: Map<string, DraftMemory>,
  matchId: string,
  part: Partial<DraftMemory>,
  max: number = MAX_REMEMBERED_MATCHES,
): void {
  const was = memory.get(matchId) ?? { edits: {}, sent: {}, versions: [] };
  setBounded(memory, matchId, { ...was, ...part }, max, (_id, m) =>
    hasUnsentEdits(m.versions, m.edits, m.sent),
  );
}

/** The newest finished version, the one to show first. */
export function latestDone(versions: DraftView[]): DraftView | null {
  for (let i = versions.length - 1; i >= 0; i--)
    if (versions[i]!.status === "done") return versions[i]!;
  return null;
}

export const REWRITE_LABELS: Record<RewriteOption, string> = {
  shorter: "Shorter",
  casual: "More casual",
  formal: "More formal",
  different_project: "Cite a different project",
  custom: "Custom…",
};

export function rewriteCost(option: RewriteOption): number {
  return TASK_CREDITS[taskForRewrite(option)];
}

export const DRAFT_COST = TASK_CREDITS.draft;

/** Why rewrites are off right now, or null when they're allowed. */
export function rewriteBlocked(versions: DraftView[]): string | null {
  if (versions.some(isWorking))
    return "Wait for the current version to finish.";
  if (versions.length >= MAX_VERSIONS)
    return `You've used all ${MAX_VERSIONS} versions for this gig. Edit the text directly instead.`;
  return null;
}

/** "7 credits · about 42 replies left", or just the cost when credits are unknown. */
export function costLine(
  cost: number,
  credits: { balance: number; repliesLeft: number } | null,
): string {
  const c = cost === 1 ? "1 credit" : `${cost} credits`;
  if (!credits) return c;
  return `${c} · about ${credits.repliesLeft} ${credits.repliesLeft === 1 ? "reply" : "replies"} left`;
}

export type Edits = Record<string, { comment?: string; dm?: string }>;

/** The text the user will send: their edit if any, else the draft's own text. */
export function textFor(
  draft: Pick<DraftView, "id" | "comment" | "dm">,
  edits: Edits,
  kind: ReplyKind,
): string {
  return edits[draft.id]?.[kind] ?? draft[kind] ?? "";
}

/** True when any version has an edit, for a kind not yet marked sent, that differs from the draft. */
export function hasUnsentEdits(
  versions: DraftView[],
  edits: Edits,
  sent: Partial<Record<ReplyKind, boolean>> = {},
): boolean {
  return versions.some((v) => {
    const e = edits[v.id];
    if (!e) return false;
    return (["comment", "dm"] as const).some(
      (k) => !sent[k] && e[k] !== undefined && e[k] !== (v[k] ?? ""),
    );
  });
}

/** Which tab to open first: the comment, unless the post only wants a DM (empty comment). */
export function firstTab(draft: Pick<DraftView, "comment" | "dm">): ReplyKind {
  return !draft.comment && draft.dm ? "dm" : "comment";
}

/** A failed draft's error code to a sentence (the API's own codes are handled by errorMessage). */
export function failedDraftMessage(code: string | null): string {
  if (code === "EXPIRED" || code === "STALE")
    return "That draft took too long and was cancelled. Your credits were refunded. Try again.";
  return "We couldn't write that draft. Your credits were refunded. Try again.";
}
