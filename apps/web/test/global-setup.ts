import { prepareDatabase } from "@redlance/db/migrate";
import { TEST_ENV } from "./test-env";

export default async function setup(): Promise<void> {
  await prepareDatabase(TEST_ENV.DATABASE_URL);
}
