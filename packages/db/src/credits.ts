// Credits: grants, reserves and refunds (docs/drafts/README.md §9, §10).
// Every money change runs in one transaction that locks the user's credit_balances row
// first, so two requests from one user can't interleave. When called with a transaction,
// the work runs in a savepoint inside it.
import { PLAN_CREDITS, type Plan } from "@redlance/core";
import { and, eq, gt, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import { creditBalances, creditLedger, drafts, llmUsage } from "./schema";

/** A database or a transaction: anything that can open a (nested) transaction. */
export type MoneyExecutor = Pick<Database, "transaction">;
type Reader = Pick<Database, "select">;
export type MoneyTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** llm_usage tasks that count toward the drafting caps and the system budget. */
export const DRAFT_COST_TASKS = ["draft", "rewrite", "voice"] as const;

const DAY_MS = 86_400_000;

/** The UTC day containing `now`, as [start, end). */
function utcDayRange(now: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function assertCredits(amount: number, what: string, allowZero = false) {
  if (!Number.isInteger(amount) || amount < (allowZero ? 0 : 1)) {
    throw new Error(
      `${what} must be a ${allowZero ? "non-negative" : "positive"} integer`,
    );
  }
}

/** Locks the user's balance row (null when the user has none). Call first in every money transaction. */
export async function lockCreditBalance(tx: MoneyTx, userId: string) {
  const [row] = await tx
    .select()
    .from(creditBalances)
    .where(eq(creditBalances.userId, userId))
    .for("update");
  return row ?? null;
}

/**
 * Starts a new plan period: the balance is replaced, not topped up (no rollover).
 * Any leftover is written off with an `expire` row before the `grant` row.
 */
export async function grantCredits(
  db: MoneyExecutor,
  g: {
    userId: string;
    plan: Plan;
    amount: number;
    periodStart: Date;
    periodEnd: Date;
  },
): Promise<void> {
  assertCredits(g.amount, "amount", true);
  if (!(g.periodEnd.getTime() > g.periodStart.getTime())) {
    throw new Error("periodEnd must be after periodStart");
  }
  await db.transaction(async (tx) => {
    // Make sure a row exists so there is always something to lock: a concurrent first
    // grant waits here and then sees this one's balance (and expires it).
    await tx
      .insert(creditBalances)
      .values({
        userId: g.userId,
        plan: g.plan,
        balance: 0,
        periodStart: g.periodStart,
        periodEnd: g.periodStart,
      })
      .onConflictDoNothing({ target: creditBalances.userId });
    const current = await lockCreditBalance(tx, g.userId);
    if (current && current.balance > 0) {
      await tx.insert(creditLedger).values({
        userId: g.userId,
        delta: -current.balance,
        reason: "expire",
      });
    }
    await tx
      .update(creditBalances)
      .set({
        plan: g.plan,
        balance: g.amount,
        periodStart: g.periodStart,
        periodEnd: g.periodEnd,
        updatedAt: sql`now()`,
      })
      .where(eq(creditBalances.userId, g.userId));
    await tx.insert(creditLedger).values({
      userId: g.userId,
      delta: g.amount,
      reason: "grant",
    });
  });
}

/** Grants the plan's credits for a period from `now` to `periodEnd`. */
export async function grantPlanCredits(
  db: MoneyExecutor,
  userId: string,
  plan: Plan,
  periodEnd: Date,
  now: Date,
): Promise<void> {
  await grantCredits(db, {
    userId,
    plan,
    amount: PLAN_CREDITS[plan],
    periodStart: now,
    periodEnd,
  });
}

export type ReserveResult =
  { ok: true; balance: number } | { ok: false; reason: "insufficient" };

/**
 * Takes `amount` credits for a draft. The guarded UPDATE locks the balance row and can't
 * take the balance below 0 or spend after the period ends; no row updated = insufficient.
 */
export async function reserveCredits(
  db: MoneyExecutor,
  r: { userId: string; amount: number; draftId: string },
): Promise<ReserveResult> {
  assertCredits(r.amount, "amount");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(creditBalances)
      .set({
        balance: sql`${creditBalances.balance} - ${r.amount}`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(creditBalances.userId, r.userId),
          gte(creditBalances.balance, r.amount),
          gt(creditBalances.periodEnd, sql`now()`),
        ),
      )
      .returning({ balance: creditBalances.balance });
    if (!row) return { ok: false, reason: "insufficient" };
    await tx.insert(creditLedger).values({
      userId: r.userId,
      delta: -r.amount,
      reason: "reserve",
      draftId: r.draftId,
    });
    return { ok: true, balance: row.balance };
  });
}

/**
 * Gives back what a draft reserved (from its ledger rows), at most once: the partial
 * unique index credit_ledger_refund_once_idx makes a second refund row a no-op.
 */
export async function refundCredits(
  db: MoneyExecutor,
  r: { userId: string; draftId: string },
): Promise<{ refunded: number }> {
  return db.transaction(async (tx) => {
    await lockCreditBalance(tx, r.userId);
    const [reserved] = await tx
      .select({
        amount: sql<number>`coalesce(-sum(${creditLedger.delta}), 0)::int`,
      })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.userId, r.userId),
          eq(creditLedger.draftId, r.draftId),
          eq(creditLedger.reason, "reserve"),
        ),
      );
    const amount = reserved?.amount ?? 0;
    if (amount <= 0) return { refunded: 0 };
    const inserted = await tx
      .insert(creditLedger)
      .values({
        userId: r.userId,
        delta: amount,
        reason: "refund",
        draftId: r.draftId,
      })
      .onConflictDoNothing({
        target: creditLedger.draftId,
        where: sql`${creditLedger.reason} = 'refund'`,
      })
      .returning({ id: creditLedger.id });
    if (inserted.length === 0) return { refunded: 0 };
    await tx
      .update(creditBalances)
      .set({
        balance: sql`${creditBalances.balance} + ${amount}`,
        updatedAt: sql`now()`,
      })
      .where(eq(creditBalances.userId, r.userId));
    await tx
      .update(drafts)
      .set({ credits: 0 })
      .where(and(eq(drafts.id, r.draftId), eq(drafts.userId, r.userId)));
    return { refunded: amount };
  });
}

/**
 * Credits spent in the UTC day of `now`: that day's reserves minus the refunds of those same
 * reserves. A refund today of a draft reserved on an earlier day doesn't lower today's usage.
 */
export async function creditsUsedToday(
  db: Reader,
  userId: string,
  now: Date,
): Promise<number> {
  const { start, end } = utcDayRange(now);
  const [row] = await db
    .select({
      used: sql<number>`coalesce(-sum(${creditLedger.delta}), 0)::int`,
    })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, userId),
        gte(creditLedger.createdAt, start),
        lt(creditLedger.createdAt, end),
        or(
          eq(creditLedger.reason, "reserve"),
          and(
            eq(creditLedger.reason, "refund"),
            sql`exists (select 1 from credit_ledger r
              where r.user_id = ${creditLedger.userId}
                and r.draft_id = ${creditLedger.draftId}
                and r.reason = 'reserve'
                and r.created_at >= ${start.toISOString()}::timestamptz
                and r.created_at < ${end.toISOString()}::timestamptz)`,
          ),
        ),
      ),
    );
  return Math.max(0, row?.used ?? 0);
}

/** One user's drafting AI cost (draft, rewrite, voice) in the UTC day of `now`, in micro-dollars. */
export async function costTodayMicros(
  db: Reader,
  userId: string,
  now: Date,
): Promise<number> {
  return draftCost(db, now, userId);
}

/** Everyone's drafting AI cost in the UTC day of `now`, in micro-dollars. */
export async function systemDraftCostTodayMicros(
  db: Reader,
  now: Date,
): Promise<number> {
  return draftCost(db, now);
}

async function draftCost(
  db: Reader,
  now: Date,
  userId?: string,
): Promise<number> {
  const { start, end } = utcDayRange(now);
  const [row] = await db
    .select({
      cost: sql<string>`coalesce(sum(${llmUsage.costMicros}), 0)`,
    })
    .from(llmUsage)
    .where(
      and(
        userId ? eq(llmUsage.userId, userId) : undefined,
        inArray(llmUsage.task, [...DRAFT_COST_TASKS]),
        gte(llmUsage.createdAt, start),
        lt(llmUsage.createdAt, end),
      ),
    );
  return Number(row?.cost ?? 0);
}

export async function getCredits(
  db: Reader,
  userId: string,
): Promise<{ plan: Plan; balance: number; periodEnd: Date } | null> {
  const [row] = await db
    .select({
      plan: creditBalances.plan,
      balance: creditBalances.balance,
      periodEnd: creditBalances.periodEnd,
    })
    .from(creditBalances)
    .where(eq(creditBalances.userId, userId));
  return row ?? null;
}

/** The system drafting budget, in USD (from DRAFT_BUDGET_ALERT_USD / DRAFT_BUDGET_PAUSE_USD). */
export type DraftBudgetSettings = {
  DRAFT_BUDGET_ALERT_USD: number;
  DRAFT_BUDGET_PAUSE_USD: number;
};

/** Today's drafting spend across all users, and whether it reached the alert or pause level. */
export async function draftBudget(
  db: Reader,
  env: DraftBudgetSettings,
  now: Date,
): Promise<{ spentMicros: number; alert: boolean; paused: boolean }> {
  const spentMicros = await systemDraftCostTodayMicros(db, now);
  return {
    spentMicros,
    alert: spentMicros >= Math.round(env.DRAFT_BUDGET_ALERT_USD * 1e6),
    paused: spentMicros >= Math.round(env.DRAFT_BUDGET_PAUSE_USD * 1e6),
  };
}

export async function isDraftingPaused(
  db: Reader,
  env: DraftBudgetSettings,
  now: Date,
): Promise<boolean> {
  return (await draftBudget(db, env, now)).paused;
}

/**
 * "Warn once a day": the returned function is true the first time it sees `key` in a
 * UTC day, false after that. Per process (each web/worker instance warns once).
 */
export function onceADay(): (key: string, now: Date) => boolean {
  const seen = new Map<string, string>();
  return (key, now) => {
    const day = now.toISOString().slice(0, 10);
    if (seen.get(key) === day) return false;
    seen.set(key, day);
    return true;
  };
}
