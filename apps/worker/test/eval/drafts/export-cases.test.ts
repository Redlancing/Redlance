import { createDb, jobPostAnalyses, jobPosts } from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import { sql } from "drizzle-orm";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { draftCaseSchema } from "./cases";
import {
  exportCases,
  profileFor,
  scrubText,
  writeExportedCases,
} from "./export-cases";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 3 });

const reset = () =>
  db.execute(
    sql`truncate table match_events, matches, job_post_analyses, job_posts, feed_polls, feeds, llm_usage cascade`,
  );

async function seed(
  n: number,
  over: { category?: string; author?: string } = {},
) {
  const [post] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `ext-${n}-${over.category ?? "x"}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/${n}/`,
      title: `[Hiring] Job ${n}, DM u/someclient_${n} or write me@example.org`,
      body: "We need help with a React dashboard. Budget $500.",
      author: over.author ?? "secretauthor",
      postedAt: new Date(Date.UTC(2026, 9, n)),
      preKind: "hiring",
      analysisStatus: "done",
    })
    .returning({ id: jobPosts.id });
  await db.insert(jobPostAnalyses).values({
    jobPostId: post!.id,
    pipelineVersion: "test",
    kind: "hiring",
    employmentType: "freelance",
    payType: "paid",
    categories: [over.category ?? "development"],
    skillIds: ["react"],
    budgetMin: 500,
    budgetMax: 500,
    currency: "USD",
    budgetUnit: "fixed",
    remote: "remote",
    redFlags: [],
    summary: "Build a React dashboard.",
    model: "test",
    applyInstructions: "DM only",
  });
}

beforeAll(async () => {
  await runMigrations(url);
});
beforeEach(reset);
afterAll(async () => {
  await reset();
  await pool.end();
});

describe("export-cases", () => {
  it("strips the author and keeps title, body, subreddit and analysis", async () => {
    await seed(1);
    const [c] = await exportCases(db);
    expect(JSON.stringify(c)).not.toContain("secretauthor");
    expect(c!.post.body).toBe(
      "We need help with a React dashboard. Budget $500.",
    );
    expect(c!.post.subreddit).toBe("forhire");
    expect(c!.post.title).toContain("Job 1");
    expect(c!.analysis).toMatchObject({
      kind: "hiring",
      categories: ["development"],
      skillIds: ["react"],
      budgetMin: 500,
      budgetUnit: "fixed",
      summary: "Build a React dashboard.",
      applyInstructions: "DM only",
    });
    expect(c!.profileId).toBe("web-dev");
  });

  it("masks usernames and emails in the text", async () => {
    await seed(2);
    const [c] = await exportCases(db);
    expect(c!.post.title).not.toMatch(/someclient|me@example/);
    expect(c!.post.title).toContain("u/[user]");
    expect(c!.post.title).toContain("[email]");
    expect(scrubText("hi /u/Some_Name and a@b.co")).toBe(
      "hi u/[user] and [email]",
    );
  });

  it("filters by category, respects the limit and only reads", async () => {
    await seed(3, { category: "video" });
    await seed(4, { category: "development" });
    await seed(5, { category: "development" });
    expect(await exportCases(db, { category: "video" })).toHaveLength(1);
    expect(await exportCases(db, { limit: 2 })).toHaveLength(2);
    const [{ n }] = (
      await db.execute(sql`select count(*)::int n from job_posts`)
    ).rows as { n: number }[];
    expect(n).toBe(3);
  });

  it("writes case files that fill in to valid cases", async () => {
    await seed(6, { category: "writing" });
    const cases = await exportCases(db);
    const dir = mkdtempSync(`${tmpdir()}/export-cases-`);
    writeExportedCases(cases, pathToFileURL(`${dir}/`));
    const files = readdirSync(dir);
    expect(files).toEqual([`${cases[0]!.id}.json`]);
    const written = JSON.parse(readFileSync(`${dir}/${files[0]}`, "utf8"));
    // Tags and expectations are filled in by hand, so only the rest must already parse.
    const parsed = draftCaseSchema.safeParse({ ...written, expect: ["x"] });
    expect(parsed.success).toBe(true);
    expect(written.profileId).toBe(profileFor("writing"));
  });
});
