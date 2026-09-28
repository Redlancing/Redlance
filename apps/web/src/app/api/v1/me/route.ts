import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";

export const GET = apiRoute({
  handler: async ({ user }) =>
    json(200, { user: { id: user.userId, email: user.email } }),
});
