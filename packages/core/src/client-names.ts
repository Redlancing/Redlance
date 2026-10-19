/**
 * Client-name removal (docs/onboarding/projects-experience-design.md, "Removing client
 * names"). Pure. Shared: the resume import (apps/worker/src/resume/names.ts adds link removal)
 * and the matching re-score context (packages/db loadRescoreContext) both use it.
 *
 * Drafts built from these lines become public Reddit comments, so a client name the model
 * points out is swapped for a generic phrase by code: the model can't change any other word,
 * and a phrase only lands where its name really occurs.
 */

import { WORK_LIMITS } from "./work";

export type ClientName = { name: string; generic: string };

/** Used when the model's phrase is empty or unusable. */
export const DEFAULT_GENERIC = "a client";
export const MAX_NAME_CHARS = 80;
export const MAX_GENERIC_CHARS = 40;
const MIN_NAME_CHARS = 2;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clean = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
const key = (s: string) => clean(s).toLowerCase();

/** The name as a pattern: literal characters, any run of whitespace between words. */
const namePattern = (name: string) =>
  clean(name).split(" ").map(escapeRe).join("\\s+");

// A name can't start or end inside a word: "Acme" doesn't match "Acmeville" or "Acme2".
const BEFORE = "(?<![\\p{L}\\p{N}])";
const AFTER = "(?![\\p{L}\\p{N}])";

/** True if `name` occurs in `text` as a whole word or phrase (any case, any spacing). */
export function nameOccurs(text: string, name: string): boolean {
  const n = clean(name);
  if (n.length < MIN_NAME_CHARS) return false;
  return new RegExp(`${BEFORE}${namePattern(n)}${AFTER}`, "iu").test(
    text.normalize("NFKC"),
  );
}

const UNSAFE_GENERIC =
  /[<>\n\r@]|https?:|www\.|[a-z0-9-]+\.[a-z]{2,}(?:\/|\b)/i;

/**
 * Words that don't identify anyone: function words, legal suffixes and generic business
 * nouns. A phrase may share these with a name ("a design studio" for "Bright Studio"), and a
 * name's leading run made only of these isn't accepted as the organisation.
 */
const COMMON_WORDS = new Set([
  "the", "and", "for", "with", "from", "its", "our", "your", "their",
  "inc", "llc", "ltd", "gmbh", "pvt", "plc", "corp", "corporation", "company",
  "limited", "private", "group", "holdings", "international", "global",
  "national", "united", "general", "first", "new",
  "services", "solutions", "technologies", "technology", "tech", "software",
  "systems", "digital", "media", "labs", "studio", "studios", "agency",
  "partners", "consulting", "client", "clients", "team", "bank",
]); // prettier-ignore

/** Case-folded words of 3+ letters, possessives dropped, common words left out. */
function nameWords(s: string): Set<string> {
  return new Set(
    s
      .normalize("NFKC")
      .toLowerCase()
      .replace(/['’]s(?![\p{L}\p{N}])/gu, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => [...w].length >= 3 && !COMMON_WORDS.has(w)),
  );
}

/** Letters and digits only, case-folded: "Acme Realty" → "acmerealty". */
const squash = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * True when `phrase` shares a word of 3+ letters (not a common word) with any name, or holds
 * a name written as one word ("acmerealty"). Such a phrase would put part of a name back.
 */
export function sharesNameWord(
  phrase: string,
  names: readonly string[],
): boolean {
  const words = nameWords(phrase);
  const flat = squash(phrase);
  return names.some((name) => {
    const own = nameWords(name);
    for (const w of own) if (words.has(w)) return true;
    // Squashed ("acmerealty"), unless the name is only common words.
    const s = squash(name);
    return own.size > 0 && [...s].length >= 3 && flat.includes(s);
  });
}

/** The first whole-word match of `name` in `text`, written as the text writes it. */
function matchIn(text: string, name: string): string | null {
  const n = clean(name);
  if (n.length < MIN_NAME_CHARS) return null;
  const m = new RegExp(`${BEFORE}${namePattern(n)}${AFTER}`, "iu").exec(
    text.normalize("NFKC"),
  );
  return m ? clean(m[0]) : null;
}

const LEGAL_SUFFIX =
  /(?:[\s,]+(?:inc|llc|ltd|gmbh|pvt|plc|co|corp|limited|private))+\.?$/i;
const EDGE_PUNCT = /^[\s,.;:!-]+|[\s,.;:!-]+$/g;

/** "Acme Realty Inc." → "Acme Realty" (any number of legal suffixes and edge punctuation). */
function withoutLegalSuffix(org: string): string {
  let base = clean(org).replace(EDGE_PUNCT, "");
  for (let prev = ""; prev !== base;) {
    prev = base;
    base = base.replace(LEGAL_SUFFIX, "").replace(EDGE_PUNCT, "");
  }
  return base;
}

/**
 * Where the model's organisation occurs in its block, as the block writes it, or null.
 * Tries the name as given, then without a legal suffix ("Acme Realty Inc." → "Acme Realty"),
 * then the longest leading run of words that occurs, as long as that run holds a word of 3+
 * letters that isn't a common word ("Acme Holdings" → "Acme", but never just "Global").
 */
export function findOrganisation(text: string, org: string): string | null {
  const exact = matchIn(text, org);
  if (exact) return exact;
  const words = withoutLegalSuffix(org)
    .split(" ")
    .map((w) => w.replace(EDGE_PUNCT, ""))
    .filter(Boolean);
  for (let k = words.length; k >= 1; k--) {
    const run = words.slice(0, k);
    if (nameWords(run.join(" ")).size === 0) continue;
    const found = matchIn(text, run.join(" "));
    if (found) return found;
  }
  return null;
}

/**
 * True when a link's host (without "www.", the TLD, dots and hyphens) or its path holds one of
 * the names written as one word: "acmerealty.com/listings" names "Acme Realty".
 */
export function linkNamesClient(
  url: string,
  names: readonly string[],
): boolean {
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return false;
  }
  const labels = u.hostname.toLowerCase().split(".").filter(Boolean);
  if (labels[0] === "www") labels.shift();
  if (labels.length > 1) labels.pop();
  const host = squash(labels.join(""));
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep it encoded
  }
  const flatPath = squash(path);
  return names.some((n) => {
    const s = squash(n);
    return [...s].length >= 3 && (host.includes(s) || flatPath.includes(s));
  });
}

// Words left dangling when a name is cut off the end of a line.
const DANGLING = new Set(
  "for at with to of and by from in on the a an via & its their our".split(" "),
);

/**
 * A line the model cut in the middle of a name ("…for Acme Rea") keeps part of it. When the
 * line ends with the start of a listed name (3+ characters, from a word start), that tail and
 * any word left dangling before it ("for") are cut off.
 */
export function cutPartialName(line: string, names: readonly string[]): string {
  const text = line.trimEnd();
  const whole = new Set(names.map(key));
  let cutAt = -1;
  for (const raw of names) {
    const name = key(raw);
    for (const m of text.matchAll(/(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])/gu)) {
      const tail = key(text.slice(m.index));
      if (
        !whole.has(tail) &&
        [...tail].length >= 3 &&
        tail.length < name.length &&
        name.startsWith(tail)
      ) {
        if (cutAt < 0 || m.index < cutAt) cutAt = m.index;
        break;
      }
    }
  }
  if (cutAt < 0) return line;
  let out = text.slice(0, cutAt);
  for (;;) {
    out = out.replace(/[\s,;:–—(/-]+$/u, "");
    const last = /(?:^|\s)([\p{L}&]+)$/u.exec(out);
    if (!last || !DANGLING.has(last[1]!.toLowerCase())) break;
    out = out.slice(0, last.index);
  }
  return out.trim();
}

/**
 * Replaces each name that occurs in `text` as a whole word, ignoring case and spacing.
 * Longest names first, in one pass, so a phrase that was just put in is never matched again.
 *
 * - Names shorter than 2 characters, and names that don't occur, are ignored.
 * - The phrase is "a client" when it is empty, over 40 characters, holds a link, an email or
 *   markup, contains any listed name that occurs in the text, or shares a word with any
 *   listed name ("Acme's agency" for "Acme Realty"): it would put (part of) a name back.
 * - The first phrase wins when a name is listed twice.
 *
 * `replaced` lists the names (trimmed, in the order given) that were replaced at least once;
 * `pairs` gives each with the phrase actually used. `opts` changes the fallback phrase and the
 * longest phrase allowed (the re-score context uses organisation descriptions, up to 60).
 */
export function replaceNames(
  text: string,
  names: readonly ClientName[],
  opts: { fallback?: string; maxPhraseChars?: number } = {},
): { text: string; replaced: string[]; pairs: ClientName[] } {
  const fallback = opts.fallback ?? DEFAULT_GENERIC;
  const maxPhrase = opts.maxPhraseChars ?? MAX_GENERIC_CHARS;
  const source = text.normalize("NFKC");
  const byKey = new Map<string, { name: string; generic: string }>();
  for (const n of names) {
    const name = clean(n.name);
    if (name.length < MIN_NAME_CHARS || byKey.has(key(name))) continue;
    if (!nameOccurs(source, name)) continue;
    byKey.set(key(name), { name, generic: clean(n.generic) });
  }
  if (byKey.size === 0) return { text, replaced: [], pairs: [] };

  const present = [...byKey.values()];
  const listed = names
    .map((n) => clean(n.name))
    .filter((n) => n.length >= MIN_NAME_CHARS);
  const phraseFor = (generic: string) =>
    !generic ||
    generic.length > maxPhrase ||
    UNSAFE_GENERIC.test(generic) ||
    present.some((p) => nameOccurs(generic, p.name)) ||
    sharesNameWord(generic, listed)
      ? fallback
      : generic;
  const ordered = present
    .map((p) => ({ ...p, phrase: phraseFor(p.generic) }))
    .sort((a, b) => b.name.length - a.name.length);

  // One alternation, longest first: at each position the longest name that fits wins.
  const re = new RegExp(
    `${BEFORE}(?:${ordered.map((p) => `(${namePattern(p.name)})`).join("|")})${AFTER}`,
    "giu",
  );
  const hit = new Set<string>();
  const out = source.replace(re, (...args: unknown[]) => {
    const groups = args.slice(1, 1 + ordered.length);
    const p = ordered[groups.findIndex((g) => g !== undefined)]!;
    hit.add(p.name);
    return p.phrase;
  });
  // In the order the names were given.
  const used = ordered.filter((p) => hit.has(p.name));
  const replaced = present.map((p) => p.name).filter((n) => hit.has(n));
  return {
    text: out,
    replaced,
    pairs: replaced.map((n) => {
      const p = used.find((u) => u.name === n)!;
      return { name: p.name, generic: p.phrase };
    }),
  };
}

/** Stands in for an organisation whose role has no usable description. */
export const NEUTRAL_ORGANISATION = "the company";

/**
 * Takes the user's own organisations (employers) out of profile text sent to a model (the
 * matching re-score context). Each organisation that occurs as a whole word, in any case or
 * spacing and also before "'s" or punctuation, becomes its role's description, or "the company"
 * when there's none or it would put a name back (see `replaceNames`). The name without a legal
 * suffix ("Acme Realty" for "Acme Realty Ltd") is replaced too, when it still holds a word that
 * isn't a common one.
 */
export function scrubOrganisations(
  text: string,
  orgs: readonly { organisation: string | null; description: string }[],
): string {
  const names: ClientName[] = [];
  for (const o of orgs) {
    if (!o.organisation) continue;
    names.push({ name: o.organisation, generic: o.description });
    const base = withoutLegalSuffix(o.organisation);
    if (key(base) !== key(o.organisation) && nameWords(base).size > 0)
      names.push({ name: base, generic: o.description });
  }
  if (names.length === 0) return text;
  return replaceNames(text, names, {
    fallback: NEUTRAL_ORGANISATION,
    maxPhraseChars: WORK_LIMITS.orgDescription,
  }).text;
}
