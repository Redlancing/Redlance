import { DRAFT_EXAMPLES } from "@redlance/core";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./client";
import { runMigrations } from "./migrate";
import { pickExamples, syncReferenceData } from "./reference";
import { draftExamples } from "./schema";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 2 });

beforeAll(async () => {
  await runMigrations(url);
});
beforeEach(async () => {
  await db.execute(sql`truncate table draft_examples`);
});
afterAll(async () => {
  await db.execute(sql`truncate table draft_examples`);
  await pool.end();
});

const rows = () =>
  db.select().from(draftExamples).orderBy(asc(draftExamples.id));

const extra = (over: Partial<typeof draftExamples.$inferInsert> = {}) => ({
  id: "zz-old-example",
  jobType: "video",
  channel: "dm" as const,
  style: "proof_first",
  postExcerpt: "old post",
  text: "old text",
  source: "handwritten" as const,
  ...over,
});

describe("syncReferenceData: draft examples", () => {
  // Case 16
  it("syncing twice gives the same rows", async () => {
    await syncReferenceData(db);
    const first = await rows();
    await syncReferenceData(db);
    expect(await rows()).toEqual(first);
    expect(first).toHaveLength(DRAFT_EXAMPLES.length);
    expect(first.every((r) => r.active && r.source === "handwritten")).toBe(
      true,
    );
    const e = DRAFT_EXAMPLES[0]!;
    const r = first.find((x) => x.id === e.id)!;
    expect(r).toMatchObject({
      jobType: e.jobType,
      channel: e.channel,
      style: e.style,
      postExcerpt: e.postExcerpt,
      text: e.text,
    });
  });

  it("a handwritten example removed from code becomes inactive; winning ones are kept", async () => {
    await db
      .insert(draftExamples)
      .values([extra(), extra({ id: "zz-winner", source: "winning" })]);
    await syncReferenceData(db);
    const [old] = await db
      .select()
      .from(draftExamples)
      .where(eq(draftExamples.id, "zz-old-example"));
    expect(old!.active).toBe(false);
    const [win] = await db
      .select()
      .from(draftExamples)
      .where(eq(draftExamples.id, "zz-winner"));
    expect(win!.active).toBe(true);
  });

  it("an edited example is updated and re-activated", async () => {
    const e = DRAFT_EXAMPLES[0]!;
    await db
      .insert(draftExamples)
      .values(
        extra({ id: e.id, text: "stale", active: false, jobType: e.jobType }),
      );
    await syncReferenceData(db);
    const [r] = await db
      .select()
      .from(draftExamples)
      .where(eq(draftExamples.id, e.id));
    expect(r).toMatchObject({ text: e.text, active: true });
  });
});

describe("pickExamples", () => {
  beforeEach(async () => {
    await syncReferenceData(db);
  });

  // Case 17
  it("video: 1 comment + 2 DMs of that type, stable order", async () => {
    const got = await pickExamples(db, "video");
    expect(got).toHaveLength(3);
    expect(got.map((e) => e.channel)).toEqual(["comment", "dm", "dm"]);
    expect(got.every((e) => e.jobType === "video")).toBe(true);
    expect(await pickExamples(db, "video")).toEqual(got);
    const dms = got.slice(1).map((e) => e.id);
    expect(dms).toEqual([...dms].sort());
  });

  it("a type with no examples gets general ones", async () => {
    const got = await pickExamples(db, "audio");
    expect(got).toHaveLength(3);
    expect(got.every((e) => e.jobType === "general")).toBe(true);
    expect(got.map((e) => e.channel)).toEqual(["comment", "dm", "dm"]);
  });

  it("tops up from general and skips inactive rows", async () => {
    const [firstVideoDm] = (await pickExamples(db, "video")).slice(1);
    await db
      .update(draftExamples)
      .set({ active: false })
      .where(eq(draftExamples.id, firstVideoDm!.id));
    const got = await pickExamples(db, "video");
    expect(got.map((e) => e.id)).not.toContain(firstVideoDm!.id);
    expect(got).toHaveLength(3);
    expect(got.filter((e) => e.jobType === "general")).toHaveLength(1);
  });

  it("respects n", async () => {
    expect(await pickExamples(db, "design", 2)).toHaveLength(2);
    expect(await pickExamples(db, "design", 1)).toHaveLength(1);
  });
});
