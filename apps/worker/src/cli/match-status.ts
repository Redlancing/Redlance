// `npm run match:status -w @redlance/worker -- you@example.com`: one user's matching state.
// Needs DATABASE_URL, and APP_ENV=local or test (it prints one user's data).
import { normalizeEmail } from "@redlance/core";
import { createDb, matchUserReport } from "@redlance/db";
import { formatUserReport, refusalFor } from "./match-report";

const refusal = refusalFor(process.env.APP_ENV);
if (refusal) {
  console.error(refusal);
  process.exit(1);
}
const email = process.argv[2] ? normalizeEmail(process.argv[2]) : "";
if (!email) {
  console.error(
    "Usage: npm run match:status -w @redlance/worker -- you@example.com",
  );
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { db, pool } = createDb(url, { max: 2 });
try {
  const report = await matchUserReport(db, email, new Date());
  if (!report) {
    console.error(
      `No onboarded user with that email (the profile is created at Finish)`,
    );
    process.exitCode = 1;
  } else {
    console.log(`\n${formatUserReport(report)}\n`);
  }
} finally {
  await pool.end();
}
