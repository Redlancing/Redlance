import "server-only";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { z } from "zod";
import { getEnv } from "./env";
import { ApiError, errorResponse } from "./errors";
import { clientIp } from "./http";
import { getLogger } from "./logger";
import { BUCKETS, type BucketConfig, getRateLimiter } from "./rate-limit";
import { getSession, type Session } from "./session";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const QUERY_INPUT = new Set(["GET", "HEAD", "DELETE"]);

type RateLimitOption = false | { bucket: string; config?: BucketConfig };

type HandlerContext<I, A extends boolean> = {
  request: Request;
  input: I;
  user: A extends true ? Session : Session | null;
  log: Logger;
  requestId: string;
};

type ApiRouteOptions<S extends z.ZodType | undefined, A extends boolean> = {
  auth?: A;
  input?: S;
  rateLimit?: RateLimitOption;
  handler: (ctx: HandlerContext<S extends z.ZodType ? z.infer<S> : undefined, A>) => Promise<Response>;
};

function checkOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(getEnv().APP_ORIGIN).origin) {
    throw new ApiError("BAD_ORIGIN", "Request origin not allowed.");
  }
}

async function parseInput(request: Request, url: URL, schema: z.ZodType): Promise<unknown> {
  let raw: unknown;
  if (QUERY_INPUT.has(request.method)) {
    raw = Object.fromEntries(url.searchParams);
  } else {
    try {
      raw = await request.json();
    } catch {
      throw new ApiError("INVALID_INPUT", "Request body must be valid JSON.");
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(
      "INVALID_INPUT",
      "Some fields are invalid.",
      result.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
    );
  }
  return result.data;
}

async function enforceRateLimit(option: RateLimitOption | undefined, user: Session | null, request: Request) {
  if (option === false) return;
  const { bucket, config } = option ?? { bucket: "api" };
  const limits = config ?? (BUCKETS as Record<string, BucketConfig>)[bucket] ?? BUCKETS.api;
  const subject = user ? `u:${user.userId}` : `ip:${clientIp(request)}`;
  const result = await getRateLimiter().consume(subject, bucket, limits);
  if (!result.allowed) {
    const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    throw new ApiError("RATE_LIMITED", `Too many requests. Try again in ${seconds} seconds.`, undefined, {
      "Retry-After": String(seconds),
    });
  }
}

/**
 * Every /api/v1 route goes through this: session → origin → input → rate limit → handler,
 * stopping at the first failure, with one log line per request.
 */
export function apiRoute<S extends z.ZodType | undefined = undefined, A extends boolean = true>(
  options: ApiRouteOptions<S, A>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const started = performance.now();
    const requestId =
      request.headers.get("x-request-id") ?? request.headers.get("x-amzn-trace-id") ?? randomUUID();
    const url = new URL(request.url);
    const log = getLogger().child({ requestId });
    let userId: string | undefined;
    let response: Response;

    try {
      const user = await getSession(request);
      if ((options.auth ?? true) && !user) throw new ApiError("UNAUTHENTICATED", "Please sign in.");
      userId = user?.userId;
      if (MUTATING.has(request.method)) checkOrigin(request);
      const input = options.input ? await parseInput(request, url, options.input) : undefined;
      await enforceRateLimit(options.rateLimit, user, request);
      response = await options.handler({
        request,
        input,
        user,
        log,
        requestId,
      } as HandlerContext<S extends z.ZodType ? z.infer<S> : undefined, A>);
    } catch (err) {
      if (!(err instanceof ApiError)) log.error({ err }, "unhandled error");
      response = errorResponse(err instanceof ApiError ? err : new ApiError("INTERNAL", "Something went wrong."), requestId);
    }

    response.headers.set("x-request-id", requestId);
    log.info(
      {
        userId,
        method: request.method,
        path: url.pathname,
        status: response.status,
        durationMs: Math.round(performance.now() - started),
      },
      "request",
    );
    return response;
  };
}
