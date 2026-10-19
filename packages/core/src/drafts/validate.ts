/**
 * Draft validators (docs/drafts/README.md §8). Pure. Code, not the model, checks that a
 * draft invents no facts: every claim-like number must come from the evidence, the post or
 * the user's instruction, and the only link allowed is the evidence's one link.
 */

import { nameOccurs } from "./../client-names";
import { SKILLS } from "./../taxonomy";
import { BANNED_PHRASES } from "./banned";
import { normalise, sentenceCount, wordCount } from "./text";
import type { Evidence, Problem, VoiceStats } from "./types";

export { normalise, sentenceCount, wordCount };

export type LengthTarget = { dmMin: number; dmMax: number };
export type DraftTexts = { comment: string; dm: string };
export type ValidateContext = {
  postText: string;
  instruction?: string;
  target: LengthTarget;
};

export const COMMENT_MAX_CHARS = 300;
export const COMMENT_MAX_SENTENCES = 3;
const DEFAULT_TARGET: LengthTarget = { dmMin: 60, dmMax: 150 };
const MIN_SENDS_FOR_VOICE = 3;
const TARGET_FLOOR = 40;
const TARGET_CEIL = 180;
/** Plain counts up to this are allowed without evidence ("2 quick questions"). */
const SMALL_COUNT_MAX = 10;

/** The DM length range: 60–150 words, or the user's average ±50% once 3+ sends are known. */
export function lengthTarget(stats?: VoiceStats): LengthTarget {
  if (!stats || stats.n < MIN_SENDS_FOR_VOICE || !(stats.avgWords > 0)) {
    return { ...DEFAULT_TARGET };
  }
  const clamp = (v: number) =>
    Math.min(TARGET_CEIL, Math.max(TARGET_FLOOR, Math.round(v)));
  return {
    dmMin: clamp(stats.avgWords * 0.5),
    dmMax: clamp(stats.avgWords * 1.5),
  };
}

// ---- links -----------------------------------------------------------------------------

/** Top-level domains that end a bare link ("evil.com/pay"). Lowercase or ALL CAPS only. */
export const LINK_TLDS = [
  "com",
  "net",
  "org",
  "io",
  "app",
  "dev",
  "ai",
  "xyz",
  "info",
  "biz",
  "link",
  "page",
  "site",
  "online",
  "store",
  "tech",
  "shop",
  "cloud",
  "studio",
  "club",
  "ink",
  "wiki",
  "blog",
  "fyi",
  "edu",
  "gov",
  "uk",
  "de",
  "fr",
  "ca",
  "au",
  "nl",
  "eu",
  "ru",
  "cn",
] as const;
/**
 * TLDs that are also short words or common typos ("it.So", "go.to"): a bare host on one of
 * these only counts as a link when a path follows ("t.me/x"). www. hosts always count.
 */
export const LINK_TLDS_NEED_PATH = [
  "me",
  "co",
  "in",
  "to",
  "sh",
  "so",
  "ly",
  "gg",
  "tv",
  "fm",
  "cc",
  "ws",
  "us",
  "pro",
  "live",
  "chat",
  "email",
  "design",
  "media",
] as const;

const HOST_LABEL = "[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?";
const PATH = "(?:\\/[^\\s<>\"'`]*)?";
const START = "(?<![\\p{L}\\p{N}_/.@-])";
const URL_RE = new RegExp(
  [
    "https?:\\/\\/[^\\s<>\"'`]+",
    `${START}www\\.(?:${HOST_LABEL}\\.)+\\p{L}{2,}${PATH}`,
    `${START}(?:${HOST_LABEL}\\.)+(?<tld>${[...LINK_TLDS, ...LINK_TLDS_NEED_PATH].join("|")})(?![\\p{L}\\p{N}-])(?<path>${PATH})`,
  ].join("|"),
  "giu",
);
const NEEDS_PATH = new Set<string>(LINK_TLDS_NEED_PATH);

/** Tool names that look like domains ("ASP.NET", "Make.com"): bare, with no path, they aren't links. */
const TOOL_NAMES = new Set<string>([
  ...SKILLS.flatMap((s) => [s.name, ...s.aliases])
    .map((n) => n.toLowerCase())
    .filter((n) => /^[\p{L}\p{N}.-]+\.\p{L}{2,}$/u.test(n)),
  "socket.io",
]);

/** The URLs in `text` as [start, end, raw], dropping look-alikes ("it.So", "me.co" with no path). */
function urlMatches(text: string): { index: number; raw: string }[] {
  const out: { index: number; raw: string }[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const tld = m.groups?.tld;
    if (tld) {
      if (tld !== tld.toLowerCase() && tld !== tld.toUpperCase()) continue;
      const hasPath = (m.groups?.path ?? "").startsWith("/");
      if (NEEDS_PATH.has(tld.toLowerCase()) && !hasPath) continue;
      if (!hasPath && TOOL_NAMES.has(m[0].toLowerCase())) continue;
    }
    out.push({ index: m.index ?? 0, raw: m[0] });
  }
  return out;
}

/** URLs in `text` (http(s), www. hosts and bare domains like evil.com/pay), trailing punctuation removed. */
export function findUrls(text: string): string[] {
  return urlMatches(text).map((u) => u.raw.replace(/[.,;:!?)\]}]+$/u, ""));
}

function withoutUrls(text: string): string {
  let out = "";
  let at = 0;
  for (const u of urlMatches(text)) {
    out += text.slice(at, u.index) + " ";
    at = u.index + u.raw.length;
  }
  return out + text.slice(at);
}

/** Scheme and "www." dropped, host lowercased, trailing slashes removed. */
function normaliseUrl(u: string): string {
  const s = u
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "");
  const i = s.indexOf("/");
  const host = (i === -1 ? s : s.slice(0, i)).toLowerCase();
  const path = i === -1 ? "" : s.slice(i);
  return (host + path).replace(/\/+$/, "");
}

// ---- numbers ---------------------------------------------------------------------------

type NumberToken = { raw: string; value: number; claim: boolean };

const NUMBER_RE =
  /(?<![\p{L}\p{N}.,])([$₹£€])?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(k|m|%|x)?(?![\p{L}\p{N}])/giu;
const CLAIM_WORD_RE = /^\s*(?:years?|yrs?|clients?)(?![\p{L}\p{N}])/iu;

function numberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const [raw, currency, int, dec, suffix] = m;
    let value = Number((int ?? "").replace(/,/g, "") + (dec ?? ""));
    const s = suffix?.toLowerCase();
    if (s === "k") value *= 1000;
    else if (s === "m") value *= 1_000_000;
    value = Math.round(value * 1e6) / 1e6;
    const after = text.slice((m.index ?? 0) + raw.length);
    const claim =
      !!currency ||
      !!suffix ||
      !!dec ||
      value > SMALL_COUNT_MAX ||
      CLAIM_WORD_RE.test(after);
    out.push({ raw, value, claim });
  }
  return out;
}

/** Numbers in `text`, normalised: 2k → 2000, 40% → 40, $1,500 → 1500. */
export function findNumbers(text: string): number[] {
  return numberTokens(text).map((t) => t.value);
}

/**
 * Claim-like numbers in `text` (the ones `validateDraft` checks) whose value `isBacked` says is
 * backed by some source are replaced with `placeholder`. Used to turn a real sent message into a
 * fact-free example.
 */
export function maskNumbers(
  text: string,
  isBacked: (value: number) => boolean,
  placeholder: string,
): string {
  let out = "";
  let at = 0;
  for (const m of text.matchAll(NUMBER_RE)) {
    const t = numberTokens(m[0]).at(0);
    const start = m.index ?? 0;
    if (!t) continue;
    const after = text.slice(start + m[0].length);
    const claim = t.claim || CLAIM_WORD_RE.test(after);
    if (!claim || !isBacked(t.value)) continue;
    out += text.slice(at, start) + placeholder;
    at = start + m[0].length;
  }
  return out + text.slice(at);
}

// ---- rules -----------------------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function bannedPhrasesIn(text: string): string[] {
  const t = normalise(text);
  return BANNED_PHRASES.filter((p) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}(?![\\p{L}\\p{N}])`, "u").test(
      t,
    ),
  );
}

/** Everything wrong with a draft; an empty list means it passes. */
export function validateDraft(
  draft: DraftTexts,
  evidence: Evidence,
  ctx: ValidateContext,
): Problem[] {
  const comment = draft.comment.trim();
  const dm = draft.dm.trim();
  if (!comment && !dm) return [{ code: "EMPTY" }];

  const problems: Problem[] = [];
  const both = `${comment}\n${dm}`;

  if (
    comment.length > COMMENT_MAX_CHARS ||
    sentenceCount(comment) > COMMENT_MAX_SENTENCES
  ) {
    problems.push({ code: "COMMENT_TOO_LONG" });
  }

  // An empty comment is fine (DM-only posts), but the DM is always expected.
  const n = wordCount(dm);
  if (n < ctx.target.dmMin)
    problems.push({ code: "DM_TOO_SHORT", detail: `${n} words` });
  else if (n > ctx.target.dmMax)
    problems.push({ code: "DM_TOO_LONG", detail: `${n} words` });

  for (const phrase of bannedPhrasesIn(both)) {
    problems.push({ code: "BANNED_PHRASE", detail: phrase });
  }

  const allowed = new Set(evidence.allowedLinks.map(normaliseUrl));
  const seenLinks = new Set<string>();
  for (const url of findUrls(both)) {
    const key = normaliseUrl(url);
    if (allowed.has(key) || seenLinks.has(key)) continue;
    seenLinks.add(key);
    problems.push({ code: "UNKNOWN_LINK", detail: url });
  }

  // Numbers inside URLs (a repo called shop2024) are not claims.
  const noUrls = withoutUrls(both);
  const supported = new Set(
    findNumbers(
      [evidence.evidenceText, ctx.postText, ctx.instruction ?? ""].join("\n"),
    ),
  );
  const seenNumbers = new Set<string>();
  for (const t of numberTokens(noUrls)) {
    if (!t.claim || supported.has(t.value) || seenNumbers.has(t.raw)) continue;
    seenNumbers.add(t.raw);
    problems.push({ code: "UNSUPPORTED_NUMBER", detail: t.raw });
  }

  if (!evidence.employerNamesAllowed) {
    for (const name of evidence.organisationNames) {
      if (nameOccurs(both, name))
        problems.push({ code: "ORGANISATION_NAME", detail: name });
    }
  }

  return problems;
}

/** One short line per problem, for the retry prompt. */
export function formatProblemsForRetry(problems: Problem[]): string {
  return problems
    .map((p) => {
      const d = p.detail ?? "";
      switch (p.code) {
        case "COMMENT_TOO_LONG":
          return `The comment is too long. Keep it to ${COMMENT_MAX_SENTENCES} sentences and ${COMMENT_MAX_CHARS} characters.`;
        case "DM_TOO_SHORT":
          return `The DM is too short (${d}). Add a little more detail.`;
        case "DM_TOO_LONG":
          return `The DM is too long (${d}). Cut it down.`;
        case "BANNED_PHRASE":
          return `You wrote "${d}", which sounds generic. Rephrase it.`;
        case "UNKNOWN_LINK":
          return `You included ${d}, which is not an allowed link. Remove it.`;
        case "UNSUPPORTED_NUMBER":
          return `You wrote ${d}, which is not in the evidence. Remove it or use a number from the evidence.`;
        case "ORGANISATION_NAME":
          return `You named ${d}. Do not name employers; describe the work instead.`;
        case "EMPTY":
          return "The draft is empty. Write a comment and a DM.";
        default:
          return `${p.code}${d ? `: ${d}` : ""}`;
      }
    })
    .join("\n");
}
