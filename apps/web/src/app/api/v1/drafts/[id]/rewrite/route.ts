import { INSTRUCTION_MAX, REWRITE_OPTIONS } from "@redlance/core";
import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { startRewrite } from "@/server/drafts";
import { json } from "@/server/http";

const OPTIONS = REWRITE_OPTIONS.filter((o) => o !== "custom") as [
  Exclude<(typeof REWRITE_OPTIONS)[number], "custom">,
  ...Exclude<(typeof REWRITE_OPTIONS)[number], "custom">[],
];

// Exactly one of a preset option or a typed instruction.
const body = z.union([
  z
    .object({
      option: z.enum(OPTIONS),
      idempotencyKey: z.uuid(),
    })
    .strict(),
  z
    .object({
      instruction: z.string().trim().min(1).max(INSTRUCTION_MAX),
      idempotencyKey: z.uuid(),
    })
    .strict(),
]);

export const POST = apiRoute({
  params: z.object({ id: z.uuid() }),
  input: body,
  handler: async ({ user, input, params }) => {
    const r = await startRewrite(
      user,
      params.id,
      input as Parameters<typeof startRewrite>[2],
    );
    return json(202, {
      draftId: r.draftId,
      status: r.status,
      version: r.version,
    });
  },
});
