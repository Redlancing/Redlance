import { CATEGORY_IDS } from "@redlance/core";
import { feedPage } from "@redlance/db";
import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { getDb } from "@/server/db";
import { ApiError } from "@/server/errors";
import { decodeCursor, toFeedResponse } from "@/server/feed";
import { json } from "@/server/http";

const categoryList = z
  .string()
  .transform((s) => s.split(",").filter(Boolean))
  .pipe(z.array(z.enum(CATEGORY_IDS)).max(3));

export const GET = apiRoute({
  input: z.object({
    view: z.enum(["best", "all"]).default("best"),
    cursor: z.string().min(1).max(200).optional(),
    type: categoryList.optional(),
    pay: z.enum(["paid", "any"]).default("any"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
  handler: async ({ user, input }) => {
    const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
    if (cursor === null)
      throw new ApiError("INVALID_INPUT", "Some fields are invalid.", [
        { path: "cursor", message: "Invalid cursor." },
      ]);
    const page = await feedPage(getDb(), user.userId, {
      view: input.view,
      cursor,
      categories: input.type?.length ? input.type : undefined,
      pay: input.pay,
      limit: input.limit,
    });
    return json(200, toFeedResponse(page));
  },
});
