// Dev only: starts a new credit period for one user (replaces the balance; no rollover).
// Run: npm run credits:grant -w @redlance/worker -- --email you@example.com --plan standard [--days 30]
// Needs DATABASE_URL, and APP_ENV=local or test (it hands out credits).
import { parseArgs } from "node:util";
import { PLAN_CREDITS, PLANS, normalizeEmail, type Plan } from "@redlance/core";
import { createDb, getCredits, grantPlanCredits, users } from "@redlance/db";
import { eq } from "drizzle-orm";

const USAGE =
  "Usage: npm run credits:grant -w @redlance/worker -- --email you@example.com --plan trial|standard|max [--days N]";

const appEnv = process.env.APP_ENV;
if (appEnv !== "local" && appEnv !== "test") {
  console.error(
    `credits:grant only runs with APP_ENV=local or test (APP_ENV is ${appEnv ?? "unset"}).`,
  );
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    plan: { type: "string" },
    days: { type: "string" },
  },
});
const email = values.email ? normalizeEmail(values.email) : "";
const plan = values.plan as Plan | undefined;
// A trial lasts 5 days; paid plans a month.
const days = Number(values.days ?? (plan === "trial" ? 5 : 30));
if (
  !email ||
  !plan ||
  !(PLANS as readonly string[]).includes(plan) ||
  !Number.isInteger(days) ||
  days < 1 ||
  days > 366
) {
  console.error(USAGE);
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const { db, pool } = createDb(url, { max: 2 });
try {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.emailNormalized, email));
  if (!user) {
    console.error("No user with that email");
    process.exitCode = 1;
  } else {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + days * 86_400_000);
    await grantPlanCredits(db, user.id, plan, periodEnd, now);
    const credits = await getCredits(db, user.id);
    console.log(
      `Granted ${PLAN_CREDITS[plan]} credits (${plan}) until ${periodEnd.toISOString()}; balance ${credits?.balance}.`,
    );
  }
} finally {
  await pool.end();
}
