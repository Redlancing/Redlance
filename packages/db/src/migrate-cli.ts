import { prepareDatabase } from "./migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set (copy apps/web/.env.example to apps/web/.env.local).",
  );
  process.exit(1);
}
await prepareDatabase(url);
console.log("Migrations applied and reference data synced.");
