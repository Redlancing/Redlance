// `npm run alerts:status -w @redlance/worker`: how alerting is doing (router backlog, outcomes,
// the delivery queue, linked channels). Counts only, no user data. Needs only DATABASE_URL.
import { alertStats, createDb } from "@redlance/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { db, pool } = createDb(url, { max: 2 });
const inMin = (d: Date) => {
  const m = Math.round((d.getTime() - Date.now()) / 60_000);
  return m <= 0 ? "due now" : `in ${m} min`;
};

try {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const s = await alertStats(db, since);
  console.log("\nAlerts");
  console.log(`  router backlog (matches not routed yet): ${s.backlog}`);
  const outcomes = Object.entries(s.outcomes).sort((a, b) => b[1] - a[1]);
  console.log(
    `  routing outcomes, last 24 h: ${outcomes.length ? "" : "none"}`,
  );
  for (const [outcome, n] of outcomes) {
    console.log(`    ${outcome.padEnd(24)} ${n}`);
  }
  const d = s.deliveries;
  console.log(
    `  deliveries: ${d.pending} pending · ${d.sending} sending · ${d.failed} failed`,
  );
  console.log(
    `  oldest pending run_after: ${
      s.oldestPendingRunAfter ? inMin(s.oldestPendingRunAfter) : "none"
    }`,
  );
  console.log(`  alerts sent, last 24 h: ${s.sentSince}`);
  console.log(
    `  telegram channels: ${s.telegram.linked} linked · ${s.telegram.disabled} disabled\n`,
  );
} finally {
  await pool.end();
}
