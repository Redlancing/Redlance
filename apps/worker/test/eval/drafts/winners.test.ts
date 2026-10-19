import {
  createDb,
  draftExamples,
  drafts,
  syncReferenceData,
} from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LONG_DM, seedPostAndDraft, seedReply, seedUser } from "./test-db";
import {
  PromoteError,
  exampleIdFor,
  listWinners,
  promoteWinner,
  stripPrivate,
} from "./winners";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 3 });

const reset = async () => {
  await db.execute(sql`truncate table users cascade`);
  await db.execute(sql`truncate table job_posts cascade`);
  await db.execute(sql`delete from draft_examples where source = 'winning'`);
};
beforeAll(async () => {
  await runMigrations(url);
});
beforeEach(reset);
afterAll(async () => {
  await reset();
  await pool.end();
});

async function winner(
  over: Parameters<typeof seedReply>[2] = {},
  user: Parameters<typeof seedUser>[1] = {},
) {
  const userId = await seedUser(db, user);
  const s = await seedPostAndDraft(db, userId);
  const replyId = await seedReply(db, { userId, ...s }, over);
  return { userId, replyId, ...s };
}

describe("eval:winners (case 11)", () => {
  it("lists only the hired, barely edited one of three sent replies", async () => {
    const a = await winner({
      status: "hired",
      outcome: "hired",
      editRatio: 0.1,
    });
    await winner({ status: "replied", outcome: "replied", editRatio: 0.5 });
    await winner({ status: "no_reply", outcome: "no_reply", editRatio: 0.05 });
    const list = await listWinners(db);
    expect(list.map((w) => w.replyId)).toEqual([a.replyId]);
    expect(list[0]).toMatchObject({ status: "hired", jobType: "development" });
  });

  it("also needs a DM of 20+ words, a draft, and not a comment", async () => {
    await winner({
      status: "replied",
      sentText: "Short DM, fewer than twenty words.",
    });
    await winner({ status: "replied", kind: "comment" });
    await winner({ status: "replied", editRatio: null });
    const w = await winner({ status: "replied", editRatio: 0.3 });
    expect((await listWinners(db)).map((x) => x.replyId)).toEqual([w.replyId]);
  });

  it("counts a replied outcome even when the status moved on", async () => {
    const w = await winner({ status: "lost", outcome: "replied" });
    expect((await listWinners(db)).map((x) => x.replyId)).toEqual([w.replyId]);
  });
});

describe("eval:winners --promote (cases 12-14)", () => {
  const sent =
    "Hi, I'm Maya Okafor. Your dashboard sounds like what I did at Brightwave Studios, and I built a reporting tool with charts for a small team, see https://github.com/maya-okafor-dev/reports for the code. I would start with the main views you need, get those working first, and then add the rest. Reach me at maya@example.com or u/someclient is fine too. Would a short call this week suit you?";

  it("saves the sent text as a winning example with no names and {link}", async () => {
    const w = await winner({
      status: "hired",
      outcome: "hired",
      sentText: sent,
    });
    const r = await promoteWinner(db, w.replyId);
    expect(r.created).toBe(true);
    const [row] = await db
      .select()
      .from(draftExamples)
      .where(eq(draftExamples.id, exampleIdFor(w.replyId)));
    expect(row).toMatchObject({
      source: "winning",
      channel: "dm",
      jobType: "development",
      style: "problem_first, has_link",
      active: true,
    });
    expect(row!.text).toContain("{link}");
    for (const bad of [
      "Maya",
      "Okafor",
      "Brightwave",
      "github.com",
      "maya-okafor-dev",
      "example.com",
      "someclient",
      "https://",
    ])
      expect(row!.text, bad).not.toContain(bad);
    expect(row!.text).toContain("a design studio");
    expect(row!.postExcerpt).toContain("React dashboard");
    expect(row!.postExcerpt).not.toContain("someclient");
    // It is gone from the winners list.
    expect(await listWinners(db)).toHaveLength(0);
  });

  it("keeps the winning row active through syncReferenceData", async () => {
    const w = await winner({
      status: "replied",
      outcome: "replied",
      sentText: sent,
    });
    await promoteWinner(db, w.replyId);
    await syncReferenceData(db);
    const [row] = await db
      .select({ active: draftExamples.active })
      .from(draftExamples)
      .where(eq(draftExamples.id, exampleIdFor(w.replyId)));
    expect(row!.active).toBe(true);
  });

  it("promoting the same reply twice leaves one example", async () => {
    const w = await winner({
      status: "hired",
      outcome: "hired",
      sentText: sent,
    });
    const first = await promoteWinner(db, w.replyId);
    const second = await promoteWinner(db, w.replyId);
    expect([first.created, second.created]).toEqual([true, false]);
    expect(second.text).toBe(first.text);
    const rows = await db
      .select()
      .from(draftExamples)
      .where(eq(draftExamples.source, "winning"));
    expect(rows).toHaveLength(1);
  });

  it("refuses a reply that is not a winner", async () => {
    const w = await winner({ status: "no_reply", outcome: "no_reply" });
    await expect(promoteWinner(db, w.replyId)).rejects.toMatchObject({
      code: "NOT_A_WINNER",
    });
  });

  it("refuses text that still fails the checks (an unsupported number)", async () => {
    const w = await winner({
      status: "hired",
      sentText: `${LONG_DM} It made the pages load 60% faster.`,
    });
    const err = await promoteWinner(db, w.replyId).catch((e) => e);
    expect(err).toBeInstanceOf(PromoteError);
    expect(err.code).toBe("CHECK_FAILED");
    expect(err.problems.map((p: { code: string }) => p.code)).toContain(
      "UNSUPPORTED_NUMBER",
    );
  });

  describe("backed facts become placeholders", () => {
    const dm = (extra: string) =>
      `Hi, your dashboard sounds like something I could take on without a long ramp up. I built Reporting Hub, a reporting tool with charts for a small team. ${extra} I would start with the main views you need, get those working first, and then add the rest. Would a short call this week suit you?`;
    const withEvidence = async (sentText: string) => {
      const w = await winner({ status: "hired", outcome: "hired", sentText });
      await db
        .update(drafts)
        .set({
          evidence: {
            project: { id: "p", title: "Reporting Hub" },
            role: null,
            evidenceText:
              "Project: Reporting Hub (2025)\nProject outcome: Cut load time by 40%",
          },
        })
        .where(eq(drafts.id, w.draftId));
      return w;
    };
    it("a number backed by the draft's evidence becomes {number}; the project title {project}", async () => {
      const w = await withEvidence(dm("It cut load time by 40% for them."));
      const r = await promoteWinner(db, w.replyId);
      expect(r.text).toContain("{number}");
      expect(r.text).toContain("{project}");
      expect(r.text).not.toMatch(/40|Reporting Hub/);
    });
    it("a budget from the post becomes {number} too", async () => {
      const userId = await seedUser(db);
      const s = await seedPostAndDraft(db, userId, {
        body: "We need a React dashboard. Budget is $1,500 for the first stage.",
      });
      const replyId = await seedReply(
        db,
        { userId, ...s },
        { status: "hired", sentText: dm("Your $1,500 budget works for me.") },
      );
      const r = await promoteWinner(db, replyId);
      expect(r.text).toMatch(/your \{number\} budget/i);
      expect(r.text).not.toContain("1,500");
    });
    it("a number backed by nothing is still refused", async () => {
      const w = await withEvidence(dm("It made pages load 60% faster."));
      const err = await promoteWinner(db, w.replyId).catch((e) => e);
      expect(err).toMatchObject({ code: "CHECK_FAILED" });
      expect(err.problems.map((p: { detail?: string }) => p.detail)).toContain(
        "60%",
      );
    });
  });

  it("refuses text that equals an eval case", async () => {
    const body =
      "We need a React dashboard with charts, filters and a clean export for our small team, and we would like a reply with a few samples, your availability and a first idea.";
    const userId = await seedUser(db);
    const s = await seedPostAndDraft(db, userId);
    const replyId = await seedReply(
      db,
      { userId, ...s },
      { status: "replied", sentText: body },
    );
    const err = await promoteWinner(db, replyId, {
      cases: {
        drafts: [
          {
            id: "x",
            tags: [],
            profileId: "web-dev",
            post: { title: "t", body, subreddit: "forhire" },
            analysis: {} as never,
            expect: ["x"],
          },
        ],
        rewrites: [],
      },
    }).catch((e) => e);
    expect(err).toMatchObject({ code: "SAME_AS_EVAL_CASE" });
  });
});

describe("stripPrivate", () => {
  const who = {
    displayName: "Maya Okafor",
    githubUsername: "maya-okafor-dev",
    organisations: [
      { organisation: "Brightwave Studios", description: "a design studio" },
    ],
  };
  it("removes an introduction, names, links, usernames, emails and phone numbers", () => {
    const out = stripPrivate(
      "My name is Maya Okafor. Call +44 7700 900123 or mail a.b@c.io. Thanks, Maya\nSee github.com/maya-okafor-dev/x and https://maya.dev/work. cc u/some_client",
      who,
    );
    expect(out).not.toMatch(
      /Maya|Okafor|7700|c\.io|maya\.dev|github|some_client|u\//i,
    );
    expect(out.match(/\{link\}/g)).toHaveLength(2);
  });
});
