import type { AttemptRecord } from "./types";

export type LlmErrorKind =
  | "timeout"
  | "rate_limited"
  | "quota_exhausted"
  | "server"
  | "invalid_output"
  | "bad_request"
  | "aborted";

const RETRYABLE: Record<LlmErrorKind, boolean> = {
  timeout: true,
  rate_limited: true,
  quota_exhausted: false,
  server: true,
  invalid_output: true,
  bad_request: false,
  aborted: false,
};

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly retryable: boolean;
  attempts: AttemptRecord[] = [];
  constructor(kind: LlmErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmError";
    this.kind = kind;
    this.retryable = RETRYABLE[kind];
  }
}
