import type { ImportKind } from "@redlance/db";
import { githubHandler } from "./github";
import { resumeHandler } from "./resume";
import type { JobHandler } from "./types";

export const handlers: Partial<Record<ImportKind, JobHandler>> = {
  resume: resumeHandler,
  github: githubHandler,
};
