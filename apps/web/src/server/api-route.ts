import "server-only";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { z } from "zod";
import { getEnv } from "./env";
import { ApiError, errorResponse } from "./errors";
import { clientIp, readBody } from "./http";
import { getLogger } from "./logger";
import { BUCKETS, type BucketConfig, getRateLimiter } from "./rate-limit";
import { getSession, type Session } from "./session";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const QUERY_INPUT = new Set(["GET", "HEAD", "DELETE"]);

type RateLimitOption = false | { bucket: string; config?: BucketConfig };

export const MAX_JSON_BYTES = 256 * 1024;

type RouteParams = Record<string, string | string[] | undefined>;
/** Next passes `{ params: Promise<…> }` as a route handler's second argument. */
export type RouteHandlerContext = { params?: Promise<RouteParams> };

type Infer<S, Fallback> = S extends z.ZodType ? z.infer<S> : Fallback;

type HandlerContext<I, P, A extends boolean> = {
  request: Request;
  input: I;
  params: P;
  user: A extends true ? Session : Session | null;
  log: Logger;
  requestId: string;
};

type ApiRouteOptions<
  S extends z.ZodType | undefined,
  P extends z.ZodType | undefined,
  A extends boolean,
> = {
  auth?: A;
  input?: S;
  /** Validates the dynamic route segments; a mismatch is a 404. */
  params?: P;
  rateLimit?: RateLimitOption;
  handler: (
    ctx: HandlerContext<Infer<S, undefined>, Infer<P, RouteParams>, A>,
  ) => Promise<Response>;
};

async function parseParams(
  context: RouteHandlerContext | undefined,
  schema: z.ZodType | undefined,
): Promise<unknown> {
  const raw = (await context?.params) ?? {};
  if (!schema) return raw;
  const result = schema.safeParse(raw);
  if (!result.success) throw new ApiError("NOT_FOUND", "Not found.");
  return result.data;
}

function checkOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(getEnv().APP_ORIGIN).origin) {
    throw new ApiError("BAD_ORIGIN", "Request origin not allowed.");
  }
}

async function parseInput(
  request: Request,
  url: URL,
  schema: z.ZodType,
): Promise<unknown> {
  let raw: unknown;
  if (QUERY_INPUT.has(request.method)) {
    raw = Object.fromEntries(url.searchParams);
  } else {
    const body = await readBody(request, MAX_JSON_BYTES);
    try {
      raw = JSON.parse(body.toString("utf8"));
    } catch {
      throw new ApiError("INVALID_INPUT", "Request body must be valid JSON.");
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(
      "INVALID_INPUT",
      "Some fields are invalid.",
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

function tooMany(retryAfterMs: number): ApiError {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return new ApiError(
    "RATE_LIMITED",
    `Too many requests. Try again in ${seconds} seconds.`,
    undefined,
    { "Retry-After": String(seconds) },
  );
}

/**
 * Per-IP bucket checked before the session lookup, so floods of junk or forged cookies are
 * refused without a database read. Skipped when no IP can be determined (never one shared
 * bucket for everyone), and for the health check (which must stay cheap). Fails open.
 */
async function enforceIpLimit(request: Request, pathname: string) {
  if (pathname === "/api/v1/health") return;
  const ip = clientIp(request);
  if (ip === "unknown") return;
  let result;
  try {
    result = await getRateLimiter().consume(`ip:${ip}`, "ip", BUCKETS.ip);
  } catch {
    return;
  }
  if (!result.allowed) throw tooMany(result.retryAfterMs);
}

async function enforceRateLimit(
  option: RateLimitOption | undefined,
  user: Session | null,
  request: Request,
) {
  if (option === false) return;
  const { bucket, config } = option ?? { bucket: "api" };
  const limits =
    config ?? (BUCKETS as Record<string, BucketConfig>)[bucket] ?? BUCKETS.api;
  const subject = user ? `u:${user.userId}` : `ip:${clientIp(request)}`;
  const result = await getRateLimiter().consume(subject, bucket, limits);
  if (!result.allowed) {
    throw tooMany(result.retryAfterMs);
  }
}

/**
 * Every /api/v1 route goes through this: IP limit → session → origin → params → input → user rate limit → handler,
 * stopping at the first failure, with one log line per request.
 */
export function apiRoute<
  S extends z.ZodType | undefined = undefined,
  P extends z.ZodType | undefined = undefined,
  A extends boolean = true,
>(
  options: ApiRouteOptions<S, P, A>,
): (request: Request, context?: RouteHandlerContext) => Promise<Response> {
  return async (request, context) => {
    const started = performance.now();
    const requestId =
      request.headers.get("x-request-id") ??
      request.headers.get("x-amzn-trace-id") ??
      randomUUID();
    const url = new URL(request.url);
    const log = getLogger().child({ requestId });
    let userId: string | undefined;
    let response: Response;

    try {
      await enforceIpLimit(request, url.pathname);
      const user = await getSession(request);
      if ((options.auth ?? true) && !user)
        throw new ApiError("UNAUTHENTICATED", "Please sign in.");
      userId = user?.userId;
      if (MUTATING.has(request.method)) checkOrigin(request);
      const params = await parseParams(context, options.params);
      const input = options.input
        ? await parseInput(request, url, options.input)
        : undefined;
      await enforceRateLimit(options.rateLimit, user, request);
      response = await options.handler({
        request,
        input,
        params,
        user,
        log,
        requestId,
      } as HandlerContext<Infer<S, undefined>, Infer<P, RouteParams>, A>);
    } catch (err) {
      if (!(err instanceof ApiError)) log.error({ err }, "unhandled error");
      response = errorResponse(
        err instanceof ApiError
          ? err
          : new ApiError("INTERNAL", "Something went wrong."),
        requestId,
      );
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
