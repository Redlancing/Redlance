/**
 * Phrases a draft must never contain (docs/drafts/README.md §7–8). Lowercase; matched
 * case-insensitively on word boundaries. The only copy: the prompt playbook (Phase 6) and
 * the validator (Phase 4) both read it.
 */
export const BANNED_PHRASES: readonly string[] = [
  "i came across your post",
  "i came across your job",
  "i am a passionate",
  "i'm a passionate",
  "dear sir",
  "dear madam",
  "dear hiring manager",
  "i hope this message finds you well",
  "i hope you are doing well",
  "kindly",
  "i can do this job",
  "i am the perfect fit",
  "i'm the perfect fit",
  "look no further",
  "as an ai",
];
