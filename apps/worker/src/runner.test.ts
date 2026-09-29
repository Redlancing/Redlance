import {
  createDb,
  enqueueImportJob,
  importJobs,
  syncReferenceData,
  users,
  type ImportKind,
} from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import { createClient, createFakeTransport } from "@redlance/llm";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseWorkerEnv } from "./env";
import { JobError, type JobHandler } from "./jobs/types";
import { createLogger } from "./logger";
import { createRunner } from "./runner";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 8 });
const env = parseWorkerEnv({
  APP_ENV: "test",
  DATABASE_URL: url,
  LLM_MODE: "fake",
});
const log = createLogger("silent");
const llm = createClient(createFakeTransport(() => ({})));

beforeAll(async () => {
  await runMigrations(url);
  await syncReferenceData(db);
});
beforeEach(async () => {
  await db.execute(sql`truncate table users cascade`);
});
afterAll(async () => {
  await pool.end();
});

async function newUser() {
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|${Math.random()}`,
      email: "a@example.com",
      emailNormalized: `${Math.random()}@example.com`,
    })
    .returning();
  return u!.id;
}
const enqueue = (userId: string, kind: ImportKind = "github") =>
  enqueueImportJob(db, { userId, kind, input: {} });
const row = async (id: string) =>
  (await db.select().from(importJobs).where(eq(importJobs.id, id)))[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(20);
  }
  throw new Error("timed out waiting");
}

// A listener the test controls.
function fakeListen() {
  let cb: () => void = () => {};
  return {
    notify: () => cb(),
    listen: async () => ({
      onNotify(f: () => void) {
        cb = f;
      },
      async close() {},
    }),
  };
}

const ok: JobHandler = async () => ({ result: { ok: true } });

function make(
  handlers: Partial<Record<ImportKind, JobHandler>>,
  extra: Partial<Parameters<typeof createRunner>[0]> = {},
) {
  const l = fakeListen();
  const runner = createRunner({
    db,
    listen: l.listen,
    handlers,
    env,
    log,
    llm,
    pollMs: 60_000,
    sweepMs: 60_000,
    ...extra,
  });
  return { runner, l };
}

describe("runner", () => {
  it("runs a notified job quickly without polling", async () => {
    const { runner, l } = make({ github: ok });
    await runner.start();
    const id = await enqueue(await newUser());
    l.notify();
    await until(async () => (await row(id)).status === "done");
    expect((await row(id)).result).toEqual({ ok: true });
    await runner.stop();
  });

  it("runs a job by polling when LISTEN never fires", async () => {
    const { runner } = make({ github: ok }, { pollMs: 50 });
    await runner.start();
    const id = await enqueue(await newUser());
    await until(async () => (await row(id)).status === "done");
    await runner.stop();
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const slow: JobHandler = async () => {
      active++;
      peak = Math.max(peak, active);
      await sleep(100);
      active--;
      return { result: {} };
    };
    const uid = await newUser();
    const ids = [] as string[];
    for (let i = 0; i < 4; i++) ids.push(await enqueue(uid));
    const { runner } = make({ github: slow }, { concurrency: 2 });
    await runner.start();
    await until(async () =>
      (await Promise.all(ids.map(row))).every((r) => r.status === "done"),
    );
    expect(peak).toBe(2);
    await runner.stop();
  });

  it("fails a non-retryable JobError with its code", async () => {
    const { runner } = make({
      github: async () => {
        throw new JobError("X", false);
      },
    });
    const id = await enqueue(await newUser());
    await runner.start();
    await runner.idle();
    const r = await row(id);
    expect(r.status).toBe("failed");
    expect(r.errorCode).toBe("X");
    await runner.stop();
  });

  it("re-queues after a plain Error", async () => {
    const { runner } = make({
      github: async () => {
        throw new Error("boom");
      },
    });
    const id = await enqueue(await newUser());
    await runner.start();
    await runner.idle();
    const r = await row(id);
    expect(r.status).toBe("queued");
    expect(r.attempts).toBe(1);
    await runner.stop();
  });

  it("times out a handler that never resolves", async () => {
    let aborted = false;
    const { runner } = make(
      {
        github: (_job, ctx) => {
          ctx.signal.addEventListener("abort", () => (aborted = true));
          return new Promise(() => {});
        },
      },
      { jobTimeoutMs: 100 },
    );
    const id = await enqueue(await newUser());
    // On the last attempt the timeout is final.
    await db.update(importJobs).set({ attempts: 2 }).where(eq(importJobs.id, id));
    await runner.start();
    await runner.idle();
    const r = await row(id);
    expect(r.status).toBe("failed");
    expect(r.errorCode).toBe("TIMEOUT");
    expect(aborted).toBe(true);
    await runner.stop();
  });

  it("survives a synchronous handler throw without an unhandled rejection", async () => {
    const seen: unknown[] = [];
    const spy = (e: unknown) => seen.push(e);
    process.on("unhandledRejection", spy);
    try {
      const { runner } = make(
        {
          github: (() => {
            throw new Error("sync");
          }) as unknown as JobHandler,
        },
        { jobTimeoutMs: 50 },
      );
      const id = await enqueue(await newUser());
      await db.update(importJobs).set({ attempts: 2 }).where(eq(importJobs.id, id));
      await runner.start();
      await runner.idle();
      await sleep(150);
      const r = await row(id);
      expect(r.status).toBe("failed");
      expect(r.errorCode).toBe("INTERNAL");
      expect(seen).toEqual([]);
      await runner.stop();
    } finally {
      process.off("unhandledRejection", spy);
    }
  });

  it("logs unexpected errors as name + stack frames, never the message", async () => {
    const calls: unknown[][] = [];
    const stub: any = {
      info: (...a: unknown[]) => calls.push(a),
      warn: (...a: unknown[]) => calls.push(a),
      error: (...a: unknown[]) => calls.push(a),
      child: () => stub,
    };
    const { runner } = make(
      {
        github: async () => {
          throw new TypeError("secret resume text");
        },
      },
      { log: stub },
    );
    await enqueue(await newUser());
    await runner.start();
    await runner.idle();
    await runner.stop();
    const errLog = calls.find(
      (c) => (c[0] as any)?.errName === "TypeError",
    )!;
    expect(errLog).toBeDefined();
    expect((errLog[0] as any).stack).toMatch(/\bat /);
    expect(JSON.stringify(calls)).not.toContain("secret resume text");
  });

  it("stop() during start leaves no timers", async () => {
    const { runner } = make({ github: ok });
    const starting = runner.start();
    await runner.stop();
    await starting;
    await runner.idle();
  });

  it("fails an unknown kind as UNSUPPORTED_JOB", async () => {
    const { runner } = make({});
    const id = await enqueue(await newUser(), "resume");
    await runner.start();
    await runner.idle();
    const r = await row(id);
    expect(r.status).toBe("failed");
    expect(r.errorCode).toBe("UNSUPPORTED_JOB");
    await runner.stop();
  });

  it("stop() waits for a running job", async () => {
    let finished = false;
    const { runner } = make({
      github: async () => {
        await sleep(200);
        finished = true;
        return { result: {} };
      },
    });
    const id = await enqueue(await newUser());
    await runner.start();
    await until(async () => (await row(id)).status === "running");
    await runner.stop();
    expect(finished).toBe(true);
    expect((await row(id)).status).toBe("done");
  });

  it("sweeps stale running jobs back into the queue", async () => {
    const id = await enqueue(await newUser());
    await db
      .update(importJobs)
      .set({
        status: "running",
        attempts: 1,
        lockedAt: sql`now() - interval '10 minutes'`,
      })
      .where(eq(importJobs.id, id));
    const { runner } = make({ github: ok });
    await runner.start(); // sweeps on start, then pumps
    await until(async () => (await row(id)).status === "done");
    await runner.stop();
  });
});
