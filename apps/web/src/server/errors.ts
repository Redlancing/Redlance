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
  | "UNAVAILABLE"
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
  UNAVAILABLE: 503,
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
