import { describe, expect, it } from "vitest";
import type { DraftView } from "@/server/drafts";
import {
  costLine,
  failedDraftMessage,
  firstTab,
  hasUnsentEdits,
  latestDone,
  rewriteBlocked,
  rewriteCost,
  textFor,
  upsertVersion,
} from "./composer-state";

function draft(
  id: string,
  version: number,
  over: Partial<DraftView> = {},
): DraftView {
  return {
    id,
    matchId: "m1",
    status: "done",
    version,
    kind: version === 1 ? "draft" : "rewrite",
    option: null,
    instruction: null,
    comment: `comment ${id}`,
    dm: `dm ${id}`,
    warning: false,
    problems: [],
    evidenceSummary: null,
    applyInstructions: null,
    redFlags: [],
    creditsCharged: 7,
    error: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    ...over,
  };
}

describe("versions", () => {
  it("upserts in version order and drops failed ones", () => {
    let v = upsertVersion([], draft("b", 2, { status: "pending" }));
    v = upsertVersion(v, draft("a", 1));
    expect(v.map((d) => d.id)).toEqual(["a", "b"]);
    v = upsertVersion(v, draft("b", 2, { status: "done" }));
    expect(v[1]!.status).toBe("done");
    expect(
      upsertVersion(v, draft("b", 2, { status: "failed" })).map((d) => d.id),
    ).toEqual(["a"]);
  });

  it("latestDone skips versions still being written", () => {
    expect(
      latestDone([draft("a", 1), draft("b", 2, { status: "running" })])?.id,
    ).toBe("a");
    expect(latestDone([])).toBeNull();
  });

  it("rewrites wait for a running version and stop at five", () => {
    expect(rewriteBlocked([draft("a", 1)])).toBeNull();
    expect(
      rewriteBlocked([draft("a", 1), draft("b", 2, { status: "pending" })]),
    ).toMatch(/Wait/);
    expect(
      rewriteBlocked([1, 2, 3, 4, 5].map((n) => draft(`d${n}`, n))),
    ).toMatch(/all 5/);
  });
});

describe("costs", () => {
  it("tone rewrites cost 1, a different project costs 7", () => {
    expect(rewriteCost("shorter")).toBe(1);
    expect(rewriteCost("custom")).toBe(1);
    expect(rewriteCost("different_project")).toBe(7);
  });

  it("cost line with and without credits", () => {
    expect(costLine(7, null)).toBe("7 credits");
    expect(costLine(1, { balance: 50, repliesLeft: 7 })).toBe(
      "1 credit · about 7 replies left",
    );
    expect(costLine(7, { balance: 7, repliesLeft: 1 })).toBe(
      "7 credits · about 1 reply left",
    );
  });
});

describe("edits", () => {
  it("the user's edit wins, else the draft text", () => {
    const d = draft("a", 1);
    expect(textFor(d, {}, "comment")).toBe("comment a");
    expect(textFor(d, { a: { dm: "mine" } }, "dm")).toBe("mine");
    expect(textFor({ ...d, dm: null }, {}, "dm")).toBe("");
  });

  it("only real changes count as unsent edits", () => {
    const v = [draft("a", 1)];
    expect(hasUnsentEdits(v, {})).toBe(false);
    expect(hasUnsentEdits(v, { a: { comment: "comment a" } })).toBe(false);
    expect(hasUnsentEdits(v, { a: { comment: "changed" } })).toBe(true);
  });

  it("opens the DM tab when the post only wants a DM", () => {
    expect(firstTab({ comment: "", dm: "hi" })).toBe("dm");
    expect(firstTab({ comment: "c", dm: "hi" })).toBe("comment");
  });

  it("failed drafts say credits came back", () => {
    expect(failedDraftMessage("EXPIRED")).toMatch(/took too long/);
    expect(failedDraftMessage("LLM_ERROR")).toMatch(/refunded/);
  });
});
