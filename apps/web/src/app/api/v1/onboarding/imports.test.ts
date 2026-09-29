import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db";
import {
  closeAll,
  cookieFor,
  req,
  resetState,
} from "../../../../../test/helpers";
import { TEST_ENV } from "../../../../../test/test-env";
import { VALID } from "../../../../../test/onboarding-fixtures";
import { POST as finish } from "./finish/route";
import { GET as getImportRoute } from "./imports/[id]/route";
import { POST as github } from "./imports/github/route";
import { POST as reset } from "./imports/reset/route";
import { POST as resume } from "./imports/resume/route";
import { GET as getState } from "./route";
import { PUT as putStep } from "./steps/[step]/route";

beforeEach(resetState);
afterAll(closeAll);

const PDF = new TextEncoder().encode("%PDF-1.7\nhello");

async function upload(
  cookie: string,
  content: Uint8Array | null,
  opts: { origin?: boolean; length?: string | null } = {},
) {
  const form = new FormData();
  if (content) form.set("file", new File([new Uint8Array(content)], "cv.pdf"));
  const built = new Request("http://x/", { method: "POST", body: form });
  const body = await built.arrayBuffer();
  const headers = new Headers({ cookie });
  headers.set("content-type", built.headers.get("content-type")!);
  if (opts.length !== null)
    headers.set("content-length", opts.length ?? String(body.byteLength));
  if (opts.origin !== false) headers.set("origin", TEST_ENV.APP_ORIGIN);
  return resume(
    req("/api/v1/onboarding/imports/resume", { method: "POST", headers, body }),
  );
}

const gh = (cookie: string, username: string) =>
  github(
    req("/api/v1/onboarding/imports/github", {
      method: "POST",
      headers: {
        cookie,
        origin: TEST_ENV.APP_ORIGIN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ username }),
    }),
  );

const post = (
  fn: (r: Request) => Promise<Response>,
  path: string,
  cookie: string,
) =>
  fn(
    req(path, {
      method: "POST",
      headers: { cookie, origin: TEST_ENV.APP_ORIGIN },
    }),
  );

const put = (cookie: string, step: string, data: unknown) =>
  putStep(
    req(`/api/v1/onboarding/steps/${step}`, {
      method: "PUT",
      headers: {
        cookie,
        origin: TEST_ENV.APP_ORIGIN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ mode: "complete", data, expectedVersion: 0 }),
    }),
    { params: Promise.resolve({ step }) },
  );

const getJob = (cookie: string, id: string) =>
  getImportRoute(
    req(`/api/v1/onboarding/imports/${id}`, { headers: { cookie } }),
    {
      params: Promise.resolve({ id }),
    },
  );

async function finishAll(cookie: string) {
  for (const step of ["import", "basics", "skills", "rates"] as const)
    await put(cookie, step, VALID[step]);
  expect((await post(finish, "/api/v1/onboarding/finish", cookie)).status).toBe(
    200,
  );
}

describe("resume upload", () => {
  it("queues a job with the bytes and no file name", async () => {
    const cookie = await cookieFor();
    const res = await upload(cookie, PDF);
    expect(res.status).toBe(202);
    const { jobId } = await res.json();
    const rows = (
      await getDb().execute(
        sql`select status, file_type, input::text as input, length(file_bytes) as len from import_jobs where id = ${jobId}`,
      )
    ).rows as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      status: "queued",
      file_type: "pdf",
      len: PDF.length,
    });
    expect(rows[0]!.input).not.toContain("cv.pdf");
  });

  it("411s without Content-Length", async () => {
    const cookie = await cookieFor();
    expect((await upload(cookie, PDF, { length: null })).status).toBe(411);
  });

  it("413s on a declared 6 MB", async () => {
    const cookie = await cookieFor();
    expect(
      (await upload(cookie, PDF, { length: String(6 * 1024 * 1024) })).status,
    ).toBe(413);
  });

  it("413s when the real body exceeds the limit despite a small Content-Length", async () => {
    const cookie = await cookieFor();
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(PDF);
    expect((await upload(cookie, big, { length: "100" })).status).toBe(413);
  });

  it("415s on a renamed .exe", async () => {
    const cookie = await cookieFor();
    expect(
      (await upload(cookie, new Uint8Array([0x4d, 0x5a, 1, 2]))).status,
    ).toBe(415);
  });

  it("400s on an empty file and on a missing file field", async () => {
    const cookie = await cookieFor();
    expect((await upload(cookie, new Uint8Array())).status).toBe(400);
    expect((await upload(cookie, null)).status).toBe(400);
  });

  it("429s on the 6th upload of the day", async () => {
    const cookie = await cookieFor();
    for (let i = 0; i < 5; i++)
      expect((await upload(cookie, PDF)).status).toBe(202);
    const res = await upload(cookie, PDF);
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("QUOTA_EXCEEDED");
  });

  it("403s without an allowed Origin", async () => {
    const cookie = await cookieFor();
    expect((await upload(cookie, PDF, { origin: false })).status).toBe(403);
  });

  it("409s after Finish", async () => {
    const cookie = await cookieFor();
    await finishAll(cookie);
    expect((await upload(cookie, PDF)).status).toBe(409);
  });
});

describe("GitHub import", () => {
  it("accepts a profile link and stores the username", async () => {
    const cookie = await cookieFor();
    const res = await gh(cookie, "github.com/octocat");
    expect(res.status).toBe(202);
    const { jobId } = await res.json();
    const rows = (
      await getDb().execute(
        sql`select input from import_jobs where id = ${jobId}`,
      )
    ).rows as { input: unknown }[];
    expect(rows[0]!.input).toEqual({ username: "octocat" });
  });

  it("400s on other hosts and empty input", async () => {
    const cookie = await cookieFor();
    expect((await gh(cookie, "gitlab.com/x")).status).toBe(400);
    expect((await gh(cookie, "  ")).status).toBe(400);
  });

  it("429s on the 11th of the day", async () => {
    const cookie = await cookieFor();
    for (let i = 0; i < 10; i++)
      expect((await gh(cookie, "octocat")).status).toBe(202);
    expect((await gh(cookie, "octocat")).status).toBe(429);
  });

  it("409s after Finish", async () => {
    const cookie = await cookieFor();
    await finishAll(cookie);
    expect((await gh(cookie, "octocat")).status).toBe(409);
  });
});

describe("import status", () => {
  it("returns the caller's job, 404s for others and bad ids", async () => {
    const cookie = await cookieFor();
    const { jobId } = await (await gh(cookie, "octocat")).json();
    const own = await getJob(cookie, jobId);
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({
      id: jobId,
      kind: "github",
      status: "queued",
      stage: "queued",
      suggestions: null,
      partial: [],
    });
    const other = await cookieFor("other@example.com");
    expect((await getJob(other, jobId)).status).toBe(404);
    expect((await getJob(cookie, "nope")).status).toBe(404);
  });
});

describe("reset", () => {
  it("deletes basics and skills but keeps other steps and imports", async () => {
    const cookie = await cookieFor();
    await gh(cookie, "octocat");
    await put(cookie, "import", VALID.import);
    await put(cookie, "basics", VALID.basics);
    await put(cookie, "skills", VALID.skills);
    expect(
      (await post(reset, "/api/v1/onboarding/imports/reset", cookie)).status,
    ).toBe(204);
    const state = await (
      await getState(req("/api/v1/onboarding", { headers: { cookie } }))
    ).json();
    expect(state.steps.map((s: { id: string }) => s.id)).toEqual(["import"]);
    expect(state.imports).toHaveLength(1);
  });

  it("409s after Finish", async () => {
    const cookie = await cookieFor();
    await finishAll(cookie);
    expect(
      (await post(reset, "/api/v1/onboarding/imports/reset", cookie)).status,
    ).toBe(409);
  });
});

describe("GET /onboarding imports", () => {
  it("includes the latest import per kind", async () => {
    const cookie = await cookieFor();
    await gh(cookie, "first");
    const second = await (await gh(cookie, "second")).json();
    await upload(cookie, PDF);
    const state = await (
      await getState(req("/api/v1/onboarding", { headers: { cookie } }))
    ).json();
    expect(state.imports).toHaveLength(2);
    const g = state.imports.find((i: { kind: string }) => i.kind === "github");
    expect(g.id).toBe(second.jobId);
    expect(
      state.imports.some((i: { kind: string }) => i.kind === "resume"),
    ).toBe(true);
  });
});
