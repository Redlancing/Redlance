// Which facts a draft or rewrite is written from (docs/drafts/README.md §4, §6). Shared by
// the worker (it builds the evidence) and the web (it refuses a "different project" rewrite
// with no other project before charging). Always rebuilt from the CURRENT draft context, so
// a project hidden or employer names turned off after v1 never reach a rewrite.
import {
  buildEvidence,
  type BudgetUnit,
  type Evidence,
  type EvidenceInput,
  type PayType,
  type RewriteOption,
} from "@redlance/core";
import type { DraftContext } from "./drafts";

/** The draft context in the evidence builder's shape. */
export function evidenceInputFor(ctx: DraftContext, now: Date): EvidenceInput {
  return {
    now,
    post: { title: ctx.post.title, summary: ctx.analysis.summary },
    analysis: {
      payType: ctx.analysis.payType as PayType,
      categories: ctx.analysis.categories,
      skillIds: ctx.analysis.skillIds,
      budgetMin: ctx.analysis.budgetMin,
      budgetMax: ctx.analysis.budgetMax,
      currency: ctx.analysis.currency,
      budgetUnit: ctx.analysis.budgetUnit as BudgetUnit | null,
      deadline: ctx.analysis.deadline,
      redFlags: ctx.analysis.redFlags,
    },
    match: ctx.match,
    profile: ctx.profile,
    projects: ctx.projects,
    roles: ctx.roles,
    allOrganisations: ctx.allOrganisations,
  };
}

type VersionEvidence = {
  version: number;
  status?: string;
  evidence: Record<string, unknown> | null;
};

/** Projects cited by any earlier version (its evidence's project and what it had cited). */
export function citedBefore(
  versions: readonly VersionEvidence[],
  version: number,
): string[] {
  const ids = new Set<string>();
  for (const v of versions) {
    if (v.version >= version || !v.evidence || v.status === "failed") continue;
    const ev = v.evidence as Partial<Evidence>;
    for (const id of ev.citedProjectIds ?? []) ids.add(id);
    if (ev.project?.id) ids.add(ev.project.id);
  }
  return [...ids];
}

export type DraftEvidenceResult =
  { evidence: Evidence } | { stop: "NO_OTHER_PROJECT" };

/**
 * v1: built from the context. A rewrite: rebuilt from the current context too, with the
 * parent's project and role pinned while they are still visible (hidden ones aren't loaded,
 * so the ranking picks again), and the parent's cited projects carried on. "Different
 * project" excludes every project cited before; none left is `NO_OTHER_PROJECT`.
 */
export function evidenceForDraft(
  ctx: DraftContext,
  draft: {
    kind: "draft" | "rewrite";
    option: RewriteOption | null;
    version: number;
    parentEvidence?: Record<string, unknown> | null;
  },
  versions: readonly VersionEvidence[],
  now: Date,
): DraftEvidenceResult {
  const input = evidenceInputFor(ctx, now);
  if (draft.kind !== "rewrite") return { evidence: buildEvidence(input) };

  if (draft.option === "different_project") {
    const cited = citedBefore(versions, draft.version);
    const evidence = buildEvidence({
      ...input,
      exclude: { projectIds: cited },
    });
    if (!evidence.project || cited.includes(evidence.project.id))
      return { stop: "NO_OTHER_PROJECT" };
    return { evidence };
  }

  const parent = (draft.parentEvidence ?? null) as Partial<Evidence> | null;
  const evidence = buildEvidence({
    ...input,
    match: {
      ...input.match,
      bestProjectId: parent?.project?.id ?? input.match.bestProjectId,
      bestRoleId: parent?.role?.id ?? input.match.bestRoleId,
    },
  });
  evidence.citedProjectIds = [
    ...new Set([
      ...(parent?.citedProjectIds ?? []),
      ...evidence.citedProjectIds,
    ]),
  ];
  return { evidence };
}
