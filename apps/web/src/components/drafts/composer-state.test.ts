import { describe, expect, it } from "vitest";
import type { DraftView } from "@/server/drafts";
import {
  canOfferDraft,
  costLine,
  failedDraftMessage,
  firstTab,
  hasUnsentEdits,
  latestDone,
  actionsBlocked,
  isConfirmed,
  mergeSent,
  mergeVersions,
  rememberDraftState,
  type DraftMemory,
  pendingFirstDraft,
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
    // A sent comment doesn't hide an unsent DM edit.
    expect(
      hasUnsentEdits(
        v,
        { a: { comment: "changed", dm: "edited" } },
        { comment: true },
      ),
    ).toBe(true);
    expect(
      hasUnsentEdits(v, { a: { comment: "changed" } }, { comment: true }),
    ).toBe(false);
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

describe("mergeVersions (older server data against what this browser knows)", () => {
  it("a version only known locally survives older server data", () => {
    const local = [draft("a", 1), draft("b", 2, { status: "pending" })];
    const server = [draft("a", 1)];
    expect(mergeVersions(local, server).map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("a draft only the server knows is added", () => {
    expect(mergeVersions([], [draft("a", 1)]).map((d) => d.id)).toEqual(["a"]);
  });

  it("the newest status wins, in either order", () => {
    const working = draft("a", 1, { status: "running", comment: null });
    const done = draft("a", 1);
    expect(mergeVersions([done], [working])[0]!.status).toBe("done");
    expect(mergeVersions([working], [done])[0]!.status).toBe("done");
    expect(
      mergeVersions(
        [draft("a", 1, { status: "pending" })],
        [draft("a", 1, { status: "running" })],
      )[0]!.status,
    ).toBe("running");
  });

  it("a version that failed is dropped, however it got there", () => {
    const pending = draft("b", 2, { status: "pending" });
    const failed = draft("b", 2, { status: "failed" });
    expect(mergeVersions([pending], [failed]).map((d) => d.id)).toEqual([]);
    expect(mergeVersions([failed], [pending]).map((d) => d.id)).toEqual([]);
  });

  it("on a tie the second (fresher) list wins and the result is in version order", () => {
    const merged = mergeVersions(
      [draft("b", 2, { comment: "old" })],
      [draft("a", 1), draft("b", 2, { comment: "new" })],
    );
    expect(merged.map((d) => d.id)).toEqual(["a", "b"]);
    expect(merged[1]!.comment).toBe("new");
  });

  it("does not mutate its inputs", () => {
    const local = [draft("a", 1)];
    mergeVersions(local, [draft("b", 2)]);
    expect(local).toHaveLength(1);
  });
});

describe("mergeSent", () => {
  it("is a union: once sent, always sent", () => {
    expect(mergeSent({ comment: true }, ["dm"])).toEqual({
      comment: true,
      dm: true,
    });
    expect(mergeSent({}, [])).toEqual({});
  });

  it("older server data can't un-send what this browser marked, and nothing is mutated", () => {
    const known = { dm: true };
    expect(mergeSent(known, [])).toEqual({ dm: true });
    expect(mergeSent(known, ["comment", "comment"])).toEqual({
      comment: true,
      dm: true,
    });
    expect(known).toEqual({ dm: true });
  });
});

describe("confirming with the server (isConfirmed, actionsBlocked)", () => {
  it("fresh page data is confirmed at once; old or missing data waits for the check", () => {
    const base = { pageVersions: true, revalidate: false } as const;
    expect(isConfirmed({ ...base, check: "pending" })).toBe(true);
    expect(isConfirmed({ ...base, revalidate: true, check: "pending" })).toBe(
      false,
    );
    expect(
      isConfirmed({ pageVersions: false, revalidate: false, check: "pending" }),
    ).toBe(false);
    expect(isConfirmed({ ...base, revalidate: true, check: "done" })).toBe(
      true,
    );
  });

  it("a failed check stays unconfirmed: no Draft reply, no paid actions", () => {
    const confirmed = isConfirmed({
      pageVersions: true,
      revalidate: true,
      check: "failed",
    });
    expect(confirmed).toBe(false);
    expect(canOfferDraft({ confirmed, versions: [], writing: false })).toBe(
      false,
    );
    expect(
      actionsBlocked({ confirmed, check: "failed", versions: [draft("a", 1)] }),
    ).toBe("Couldn't check for newer versions.");
    expect(
      actionsBlocked({
        confirmed,
        check: "pending",
        versions: [draft("a", 1)],
      }),
    ).toBe("Checking for newer versions…");
    expect(
      actionsBlocked({
        confirmed: true,
        check: "done",
        versions: [draft("a", 1)],
      }),
    ).toBeNull();
    expect(
      actionsBlocked({
        confirmed: true,
        check: "done",
        versions: [draft("a", 1, { status: "running" })],
      }),
    ).toBe("Wait for the current version to finish.");
  });
});

describe("rememberDraftState (the composer's per-tab memory)", () => {
  const empty = (): DraftMemory => ({ edits: {}, sent: {}, versions: [] });

  it("merges a part into what is remembered for the match", () => {
    const m = new Map<string, DraftMemory>();
    rememberDraftState(m, "m1", { sent: { dm: true } });
    rememberDraftState(m, "m1", { versions: [draft("a", 1)] });
    expect(m.get("m1")).toEqual({
      ...empty(),
      sent: { dm: true },
      versions: [draft("a", 1)],
    });
  });

  it("evicts the oldest above the cap, but never one with unsent edits", () => {
    const m = new Map<string, DraftMemory>();
    // m0 has an edit not marked sent: kept.
    rememberDraftState(m, "m0", {
      versions: [draft("a", 1)],
      edits: { a: { comment: "my words" } },
    });
    // m1's edit was sent: can go.
    rememberDraftState(m, "m1", {
      versions: [draft("b", 1)],
      edits: { b: { comment: "sent words" } },
      sent: { comment: true },
    });
    rememberDraftState(m, "m2", {}, 2);
    expect([...m.keys()]).toEqual(["m0", "m2"]);
    rememberDraftState(m, "m3", {}, 2);
    expect([...m.keys()]).toEqual(["m0", "m3"]);
  });
});

describe("canOfferDraft", () => {
  it("never offers the button before the server has been checked", () => {
    expect(
      canOfferDraft({ confirmed: false, versions: [], writing: false }),
    ).toBe(false);
  });
  it("offers it only when confirmed, with nothing drafted or being written", () => {
    expect(
      canOfferDraft({ confirmed: true, versions: [], writing: false }),
    ).toBe(true);
    expect(
      canOfferDraft({ confirmed: true, versions: [], writing: true }),
    ).toBe(false);
    expect(
      canOfferDraft({
        confirmed: true,
        versions: [draft("a", 1)],
        writing: false,
      }),
    ).toBe(false);
  });
});

describe("pendingFirstDraft", () => {
  it("holds the place of a draft just started, so it is never offered again", () => {
    const p = pendingFirstDraft("m1", "d1", "2026-10-21T10:00:00.000Z");
    expect(p).toMatchObject({
      id: "d1",
      matchId: "m1",
      status: "pending",
      version: 1,
    });
    expect(
      canOfferDraft({ confirmed: true, versions: [p], writing: false }),
    ).toBe(false);
  });

  it("the real row replaces it, and older server data can't push it back", () => {
    const p = pendingFirstDraft("m1", "d1", "2026-10-21T10:00:00.000Z");
    const real = draft("d1", 1);
    expect(upsertVersion([p], real)).toEqual([real]);
    expect(mergeVersions([real], [])).toEqual([real]);
    expect(mergeVersions([p], [])).toEqual([p]);
  });
});
