export const DRAFT_STATUSES = ["pending", "running", "done", "failed"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const DRAFT_KINDS = ["draft", "rewrite"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const REPLY_KINDS = ["comment", "dm"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

export const REPLY_STATUSES = [
  "sent",
  "replied",
  "hired",
  "lost",
  "no_reply",
  "ghosted",
] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

export const OUTCOME_TYPES = [
  "replied",
  "hired",
  "lost",
  "no_reply",
  "ghosted",
  "unpaid",
] as const;
export type OutcomeType = (typeof OUTCOME_TYPES)[number];

export const LEDGER_REASONS = [
  "grant",
  "reserve",
  "refund",
  "expire",
  "adjust",
] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

export const EVAL_CANDIDATE_REASONS = [
  "validator_failed_twice",
  "heavy_edit",
  "many_rewrites",
  "thumbs_down",
] as const;
export type EvalCandidateReason = (typeof EVAL_CANDIDATE_REASONS)[number];

export const EVAL_REVIEW_STATUSES = ["pending", "added", "skipped"] as const;
export type EvalReviewStatus = (typeof EVAL_REVIEW_STATUSES)[number];

export const VOICE_UPDATE_STATUSES = ["idle", "pending", "running"] as const;
export type VoiceUpdateStatus = (typeof VOICE_UPDATE_STATUSES)[number];

export const EXAMPLE_SOURCES = ["handwritten", "winning"] as const;
export type ExampleSource = (typeof EXAMPLE_SOURCES)[number];

/** A project chosen to cite, after the privacy rules (hidden ones never get here). */
export type EvidenceProject = {
  id: string;
  title: string;
  summary: string | null;
  outcomes: string[];
  skills: string[];
  link: string | null;
  year: number | null;
};

/** A role chosen to cite; `organisation` is null unless employer names are allowed. */
export type EvidenceRole = {
  id: string;
  title: string;
  organisation: string | null;
  organisationDescription: string | null;
  highlights: string[];
  startYear: number | null;
  endYear: number | null;
  isCurrent: boolean;
};

/** Whether the draft may mention a rate, and the line to use when it may. */
export type RateNote = { mention: true; text: string } | { mention: false };

/** The facts one draft was written from (stored as jsonb on the draft). Built by `buildEvidence`. */
export type Evidence = {
  project: EvidenceProject | null;
  role: EvidenceRole | null;
  /** Skill names to mention, top 3, in the post's order. */
  skills: string[];
  /** The only URLs the draft may contain (0 or 1 entries). */
  allowedLinks: string[];
  rateNote: RateNote;
  availability: string | null;
  /** Shown to the user only; never put in the prompt. */
  redFlags: string[];
  broad: boolean;
  employerNamesAllowed: boolean;
  /** Every organisation name from the user's roles, for the validator; never sent to the model. */
  organisationNames: string[];
  /** Every fact sent to the model, as one string; the number check reads it. */
  evidenceText: string;
  /** For the UI line "Using: …". */
  summary: {
    projectTitle: string | null;
    roleTitle: string | null;
    skills: string[];
  };
  /** Projects cited by this draft and its earlier versions ("different project" skips them). */
  citedProjectIds: string[];
};

/** The model's plan before it writes: what the client needs, and the one fact to cite. */
export type DraftPlan = {
  problem: string;
  citedFact: string;
  applyInstructions: string | null;
};

/** What the model returns: the plan plus both texts. */
export type DraftOutput = DraftPlan & {
  comment: string;
  dm: string;
};

/** One thing a validator found wrong with a draft. */
export type Problem = {
  code: string;
  detail?: string;
};

/** Numbers measured from a user's sent replies (running averages; rates are 0–1). */
export type VoiceStats = {
  /** Sends counted so far. */
  n: number;
  avgWords: number;
  avgWordsPerSentence: number;
  greetingRate: number;
  signOffRate: number;
  emojiRate: number;
  avgExclamations: number;
  lowercaseStartRate: number;
  linkRate: number;
  /** Where the link sits in the text, 0 = start, 1 = end (averaged over sends with a link). */
  avgLinkPosition: number;
  mentionsRateRate: number;
  avgEditRatio: number;
};
