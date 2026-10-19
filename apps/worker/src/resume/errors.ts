export type ResumeErrorCode = "NO_TEXT" | "UNSUPPORTED_FILE";

export class ResumeError extends Error {
  constructor(
    readonly code: ResumeErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ResumeError";
  }
}
