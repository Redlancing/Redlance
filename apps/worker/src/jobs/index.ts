import type { ImportKind } from "@redlance/db";
import type { JobHandler } from "./types";

// Task 7 adds `resume`, task 8 adds `github`.
export const handlers: Partial<Record<ImportKind, JobHandler>> = {};
