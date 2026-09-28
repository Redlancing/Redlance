import { v7 } from "uuid";

/** Time-sortable UUIDv7 for new tables. Postgres 17 has no built-in uuidv7(). */
export function newId(): string {
  return v7();
}
