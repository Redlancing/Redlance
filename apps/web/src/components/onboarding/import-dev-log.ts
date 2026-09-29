import type { ImportSummary } from "@/server/onboarding/imports";

type DevConsole = Pick<Console, "info" | "table" | "dir">;

const short = (id: string) => `${id.slice(0, 8)}…`;

/**
 * Dev only: logs each tracked import's stage change and, when a job finishes, the
 * suggestions it returned (or its error code) to the browser console. Next inlines
 * NODE_ENV, so production builds drop this entirely and print nothing.
 */
export function logImportChanges(
  prev: ImportSummary[],
  next: ImportSummary[],
  out: DevConsole = console,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (nodeEnv === "production") return;
  for (const job of next) {
    const before = prev.find((p) => p.id === job.id);
    if (before && before.stage === job.stage && before.status === job.status)
      continue;
    out.info(
      `[import] ${job.kind} ${short(job.id)} → ${job.stage}` +
        (before ? ` (was ${before.stage})` : ""),
    );
    if (before?.status === job.status) continue;
    if (job.status === "failed") {
      out.info(
        `[import] ${job.kind} ${short(job.id)} failed: ${job.errorCode}`,
      );
    } else if (job.status === "done") {
      const s = job.suggestions;
      out.info(`[import] ${job.kind} ${short(job.id)} suggestions:`);
      if (!s) {
        out.info("(none)");
        continue;
      }
      out.dir({
        basics: s.basics,
        githubUsername: s.githubUsername,
        partial: job.partial,
      });
      if (s.skills.length) out.table(s.skills);
      if (s.customSkills.length) out.table(s.customSkills);
    }
  }
}
