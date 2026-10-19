/**
 * Voice learning (docs/drafts/plan/09-voice.md). Pure: counts what a sent reply looks like,
 * keeps running averages per user, turns them into prompt lines, and decides when the
 * worker should rewrite the user's voice notes.
 */

import {
  VOICE_EVERY,
  VOICE_FIRST_AFTER,
  VOICE_MAX_PER_DAY,
  VOICE_SAME_OPTION_STREAK,
} from "./plans";
import { editRatio, sentenceCount, wordCount } from "./text";
import type { VoiceStats } from "./types";

/** What one sent reply looks like. */
export type SendMeasure = {
  words: number;
  wordsPerSentence: number;
  greeting: boolean;
  signOff: boolean;
  emoji: boolean;
  exclamations: number;
  lowercaseStart: boolean;
  hasLink: boolean;
  /** 0 = start of the text, 1 = end; null when there is no link. */
  linkPosition: number | null;
  mentionsRate: boolean;
  editRatio: number;
};

/** Sends needed before the stats become prompt lines. */
export const MIN_SENDS_FOR_TARGETS = 3;
/** A send needs this many words to be shown as an example. */
export const MIN_BEST_SEND_WORDS = 20;
const MAX_BEST_SENDS = 2;

const LINK_RE = /https?:\/\/[^\s<>"')]+|\b(?:www\.)?github\.com\/[^\s<>"')]+/gi;
const GREETING_RE =
  /^\W*(hi|hey|hello|hiya|howdy|yo|greetings|good\s+(morning|afternoon|evening)|hey\s+there|hi\s+there)\b/i;
const SIGN_OFF_RE =
  /^\W*(thanks|thank\s+you|cheers|best|regards|best\s+regards|kind\s+regards|warm\s+regards|talk\s+soon|speak\s+soon|looking\s+forward|ttyl)\b[^\n]{0,30}$/i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const RATE_RE =
  /[$£€₹]\s?\d|\b\d[\d,.]*\s?(usd|inr|gbp|eur|dollars|bucks)\b|\/\s?(hr|hour)\b|\bper\s+hour\b|\bmy\s+rate\b|\bhourly\b/i;

const firstLetter = (s: string) => s.match(/\p{L}/u)?.[0];

export const measureSend = (sent: string, aiText: string): SendMeasure => {
  const text = sent.trim();
  const words = wordCount(text);
  const sentences = sentenceCount(text);
  const lastLine =
    text
      .split(/\n+/)
      .filter((l) => l.trim())
      .pop() ?? "";
  const first = firstLetter(text);

  LINK_RE.lastIndex = 0;
  const link = LINK_RE.exec(text);
  const linkPosition =
    link && text.length > 0
      ? Math.min(1, Math.max(0, link.index / text.length))
      : null;

  return {
    words,
    wordsPerSentence: sentences > 0 ? words / sentences : 0,
    greeting: GREETING_RE.test(text),
    signOff: SIGN_OFF_RE.test(lastLine.trim()),
    emoji: EMOJI_RE.test(text),
    exclamations: (text.match(/!/g) ?? []).length,
    lowercaseStart:
      first !== undefined &&
      first === first.toLowerCase() &&
      first !== first.toUpperCase(),
    hasLink: link !== null,
    linkPosition,
    mentionsRate: RATE_RE.test(text),
    editRatio: editRatio(text, aiText),
  };
};

const EMPTY_STATS: VoiceStats = {
  n: 0,
  avgWords: 0,
  avgWordsPerSentence: 0,
  greetingRate: 0,
  signOffRate: 0,
  emojiRate: 0,
  avgExclamations: 0,
  lowercaseStartRate: 0,
  linkRate: 0,
  avgLinkPosition: 0,
  mentionsRateRate: 0,
  avgEditRatio: 0,
};

/** Running average: (old × n + x) ÷ (n + 1). */
const avg = (old: number, n: number, x: number) => (old * n + x) / (n + 1);

export const updateStats = (
  stats: VoiceStats | null,
  m: SendMeasure,
): VoiceStats => {
  const s = stats ?? EMPTY_STATS;
  const n = s.n;
  const bool = (b: boolean) => (b ? 1 : 0);
  // The link position averages over sends that had a link, so recover that count.
  const linkSends = Math.round(s.linkRate * n);
  return {
    n: n + 1,
    avgWords: avg(s.avgWords, n, m.words),
    avgWordsPerSentence: avg(s.avgWordsPerSentence, n, m.wordsPerSentence),
    greetingRate: avg(s.greetingRate, n, bool(m.greeting)),
    signOffRate: avg(s.signOffRate, n, bool(m.signOff)),
    emojiRate: avg(s.emojiRate, n, bool(m.emoji)),
    avgExclamations: avg(s.avgExclamations, n, m.exclamations),
    lowercaseStartRate: avg(s.lowercaseStartRate, n, bool(m.lowercaseStart)),
    linkRate: avg(s.linkRate, n, bool(m.hasLink)),
    avgLinkPosition:
      m.linkPosition === null
        ? s.avgLinkPosition
        : avg(s.avgLinkPosition, linkSends, m.linkPosition),
    mentionsRateRate: avg(s.mentionsRateRate, n, bool(m.mentionsRate)),
    avgEditRatio: avg(s.avgEditRatio, n, m.editRatio),
  };
};

/** Plain prompt lines for the drafter; empty until there are enough sends to trust. */
export const statsToTargets = (stats: VoiceStats): string[] => {
  if (stats.n < MIN_SENDS_FOR_TARGETS) return [];
  const lines: string[] = [];
  if (stats.avgWords > 0)
    lines.push(`Aim for about ${Math.round(stats.avgWords)} words.`);
  if (stats.avgWordsPerSentence > 0 && stats.avgWordsPerSentence <= 10)
    lines.push("Keep sentences short.");
  if (stats.greetingRate < 0.2) lines.push("No greeting line.");
  else if (stats.greetingRate > 0.7) lines.push("Start with a short greeting.");
  if (stats.signOffRate < 0.2) lines.push("No sign-off.");
  else if (stats.signOffRate > 0.7) lines.push("End with a short sign-off.");
  if (stats.emojiRate < 0.1) lines.push("No emoji.");
  if (stats.avgExclamations < 0.2) lines.push("No exclamation marks.");
  if (stats.lowercaseStartRate > 0.7) lines.push("Start in lowercase.");
  if (stats.linkRate >= 0.5) {
    if (stats.avgLinkPosition >= 0.7) lines.push("Put the link at the end.");
    else if (stats.avgLinkPosition <= 0.3)
      lines.push("Put the link near the start.");
  }
  return lines;
};

export type VoiceUpdateInput = {
  /** Sends counted in the stats, including this one. */
  sendsCounted: number;
  sendsSinceUpdate: number;
  /** The user's latest rewrite options, in order. */
  recentOptions: string[];
  updatesToday: number;
};

export const shouldUpdateVoice = (i: VoiceUpdateInput): boolean => {
  if (i.updatesToday >= VOICE_MAX_PER_DAY) return false;
  if (i.sendsCounted === VOICE_FIRST_AFTER) return true;
  if (i.sendsSinceUpdate >= VOICE_EVERY) return true;
  const last = i.recentOptions.slice(-VOICE_SAME_OPTION_STREAK);
  return (
    last.length === VOICE_SAME_OPTION_STREAK && last.every((o) => o === last[0])
  );
};

export type BestSendCandidate = {
  id: string;
  editRatio: number;
  status: string;
  text: string;
};

const isWin = (status: string) => status === "replied" || status === "hired";

/** Up to 2 reply ids: lowest edit ratio first, replied/hired ahead on ties, ≥ 20 words only. */
export const pickBestSends = (replies: BestSendCandidate[]): string[] =>
  replies
    .filter((r) => wordCount(r.text) >= MIN_BEST_SEND_WORDS)
    .sort(
      (a, b) =>
        a.editRatio - b.editRatio ||
        Number(isWin(b.status)) - Number(isWin(a.status)),
    )
    .slice(0, MAX_BEST_SENDS)
    .map((r) => r.id);
