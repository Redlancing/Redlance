import "server-only";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "BAD_ORIGIN"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_FILE"
  | "LENGTH_REQUIRED"
  | "VERSION_CONFLICT"
  | "STEP_ORDER"
  | "ALREADY_ONBOARDED"
  | "INSUFFICIENT_CREDITS"
  | "DAILY_LIMIT"
  | "PLAN_EXPIRED"
  | "MAX_VERSIONS"
  | "DRAFT_NOT_READY"
  | "IDEMPOTENCY_CONFLICT"
  | "MATCH_WITHDRAWN"
  | "NO_OTHER_PROJECT"
  | "PROFILE_EDIT_LIMIT"
  | "INSIGHTS_LOCKED"
  | "UNAVAILABLE"
  | "TELEGRAM_UNAVAILABLE"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  BAD_ORIGIN: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_FILE: 415,
  LENGTH_REQUIRED: 411,
  VERSION_CONFLICT: 409,
  STEP_ORDER: 409,
  ALREADY_ONBOARDED: 409,
  INSUFFICIENT_CREDITS: 402,
  DAILY_LIMIT: 429,
  PLAN_EXPIRED: 403,
  MAX_VERSIONS: 409,
  DRAFT_NOT_READY: 409,
  IDEMPOTENCY_CONFLICT: 409,
  MATCH_WITHDRAWN: 409,
  NO_OTHER_PROJECT: 409,
  PROFILE_EDIT_LIMIT: 429,
  INSIGHTS_LOCKED: 403,
  UNAVAILABLE: 503,
  TELEGRAM_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class ApiError extends Error {
  override name = "ApiError";
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export function errorResponse(err: ApiError, requestId: string): Response {
  const error = {
    code: err.code,
    message: err.message,
    requestId,
    ...(err.details === undefined ? {} : { details: err.details }),
  };
  return Response.json({ error }, { status: err.status, headers: err.headers });
}
