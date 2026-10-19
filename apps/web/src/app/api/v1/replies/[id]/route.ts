import { REPLY_STATUSES } from "@redlance/core";
import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";
import { updateReply } from "@/server/replies";

const SETTABLE = REPLY_STATUSES.filter((s) => s !== "sent") as [
  Exclude<(typeof REPLY_STATUSES)[number], "sent">,
  ...Exclude<(typeof REPLY_STATUSES)[number], "sent">[],
];

export const PATCH = apiRoute({
  params: z.object({ id: z.uuid() }),
  input: z
    .object({
      status: z.enum(SETTABLE),
      agreedRateMinor: z.number().int().min(0).max(100_000_000).optional(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
      unpaid: z.boolean().optional(),
    })
    .superRefine((v, ctx) => {
      const rate = v.agreedRateMinor !== undefined;
      if ((rate || v.currency) && v.status !== "hired")
        ctx.addIssue({
          code: "custom",
          path: [rate ? "agreedRateMinor" : "currency"],
          message: "A rate can only be recorded when hired.",
        });
      else if (rate !== (v.currency !== undefined))
        ctx.addIssue({
          code: "custom",
          path: [rate ? "currency" : "agreedRateMinor"],
          message: "Give the rate and its currency together.",
        });
    }),
  handler: async ({ user, input, params }) =>
    json(200, await updateReply(user, params.id, input)),
});
