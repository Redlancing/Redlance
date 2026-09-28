import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { getEnv } from "@/server/env";
import { ApiError, errorResponse } from "@/server/errors";
import { json } from "@/server/http";
import {
  clearDevSessionCookie,
  devSessionCookie,
  signInDevUser,
} from "@/server/session";

const notFound = () =>
  errorResponse(new ApiError("NOT_FOUND", "Not found."), randomUUID());

const signIn = apiRoute({
  auth: false,
  input: z.object({ email: z.email() }),
  handler: async ({ input }) => {
    const session = await signInDevUser(input.email);
    return json(
      200,
      { user: { id: session.userId, email: session.email } },
      {
        "Set-Cookie": devSessionCookie(session.userId),
      },
    );
  },
});

const signOut = apiRoute({
  auth: false,
  rateLimit: false,
  handler: async () =>
    new Response(null, {
      status: 204,
      headers: { "Set-Cookie": clearDevSessionCookie() },
    }),
});

// Local-only: this route does not exist unless AUTH_MODE=dev.
export async function POST(request: Request): Promise<Response> {
  return getEnv().AUTH_MODE === "dev" ? signIn(request) : notFound();
}

export async function DELETE(request: Request): Promise<Response> {
  return getEnv().AUTH_MODE === "dev" ? signOut(request) : notFound();
}
