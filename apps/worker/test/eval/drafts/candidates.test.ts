import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createDb, draftEvalCandidates, addEvalCandidate } from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PROFILE_BY_ID } from "./profiles";
import { draftCaseSchema } from "./cases";
import { addCandidate, listCandidates, skipCandidate } from "./candidates";
import { seedPostAndDraft, seedUser } from "./test-db";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 3 });

const reset = async () => {
  await db.execute(sql`truncate table users cascade`);
  await db.execute(sql`truncate table job_posts cascade`);
};
beforeAll(async () => {
  await runMigrations(url);
});
beforeEach(reset);
afterAll(async () => {
  await reset();
  await pool.end();
});

async function candidate(
  reason: "validator_failed_twice" | "heavy_edit" = "validator_failed_twice",
  post: { title?: string; body?: string } = {},
) {
  const userId = await seedUser(db);
  const s = await seedPostAndDraft(db, userId, post);
  await addEvalCandidate(db, s.draftId, reason);
  const [c] = await db
    .select()
    .from(draftEvalCandidates)
    .where(eq(draftEvalCandidates.draftId, s.draftId));
  return { id: c!.id, ...s };
}
const tmpDir = () => pathToFileURL(`${mkdtempSync(`${tmpdir()}/eval-cand-`)}/`);

describe("eval:candidates", () => {
  it("lists pending candidates with the post, the draft and the reason", async () => {
    const a = await candidate();
    const list = await listCandidates(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: a.id,
      reason: "validator_failed_twice",
      comment: "Sent you a DM.",
      dm: "Hi there.",
      post: { subreddit: "forhire" },
    });
    expect(list[0]!.problems?.[0]?.code).toBe("UNKNOWN_LINK");
  });

  it("--add writes a case file with a synthetic profile and marks the candidate added (case 9)", async () => {
    const a = await candidate("heavy_edit", {
      title: "[Hiring] Dashboard, DM u/realclient_99 or mail boss@realfirm.io",
    });
    const dir = tmpDir();
    const r = await addCandidate(db, a.id, { dir });
    expect(readdirSync(dir)).toEqual([`${r.caseId}.json`]);
    expect(r.caseId).toMatch(/^cand-heavy-edit-[0-9a-f]{8}$/);
    const written = JSON.parse(
      readFileSync(new URL(`${r.caseId}.json`, dir), "utf8"),
    );
    expect(draftCaseSchema.safeParse(written).success).toBe(true);
    expect(PROFILE_BY_ID.has(written.profileId)).toBe(true);
    expect(written.profileId).toBe("web-dev");
    expect(written.analysis.applyInstructions).toBe("DM only");
    expect(written.expect.length).toBeGreaterThan(0);
    // Usernames and emails are masked; the real author is never exported.
    const text = JSON.stringify(written);
    expect(text).not.toMatch(/realclient|realfirm|someclient/);
    const [row] = await db
      .select()
      .from(draftEvalCandidates)
      .where(eq(draftEvalCandidates.id, a.id));
    expect(row!.reviewStatus).toBe("added");
    expect(await listCandidates(db)).toHaveLength(0);
  });

  it("--add refuses a candidate that is not pending", async () => {
    const a = await candidate();
    await addCandidate(db, a.id, { dir: tmpDir() });
    await expect(addCandidate(db, a.id, { dir: tmpDir() })).rejects.toThrow(
      /already added/,
    );
    await expect(
      addCandidate(db, "00000000-0000-7000-8000-000000000000"),
    ).rejects.toThrow(/No candidate/);
  });

  it("--skip marks it skipped, once", async () => {
    const a = await candidate();
    expect(await skipCandidate(db, a.id)).toBe(true);
    expect(await skipCandidate(db, a.id)).toBe(false);
    expect(await listCandidates(db)).toHaveLength(0);
    const [row] = await db
      .select()
      .from(draftEvalCandidates)
      .where(eq(draftEvalCandidates.id, a.id));
    expect(row!.reviewStatus).toBe("skipped");
  });
});
