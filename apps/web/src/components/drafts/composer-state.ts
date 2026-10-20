import {
  MAX_VERSIONS,
  TASK_CREDITS,
  taskForRewrite,
  type RewriteOption,
} from "@redlance/core";
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
