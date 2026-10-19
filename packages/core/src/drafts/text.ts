/**
 * Small text measures shared by the validators (Phase 4), voice stats (Phase 9) and the
 * reply tracker's edit ratio (Phase 8). Pure.
 */

/** Lowercase, curly quotes made straight, whitespace collapsed. */
export const normalise = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const words = (s: string) =>
  s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

export const wordCount = (s: string) => words(s).length;

/** Sentences end at . ! ? (runs count once); trailing text without one is a sentence too. */
export const sentenceCount = (s: string) => {
  const t = s.trim();
  if (!t) return 0;
  return t.split(/[.!?]+(?=\s|$)/).filter((p) => /[\p{L}\p{N}]/u.test(p))
    .length;
};

/**
 * How much the user changed the AI text: word-level edit distance ÷ the AI text's word
 * count, capped at 1. 0 = sent as written. An empty AI text counts as fully rewritten
 * unless the sent text is empty too.
 */
export const editRatio = (sent: string, ai: string) => {
  const a = words(normalise(ai));
  const b = words(normalise(sent));
  if (a.length === 0) return b.length === 0 ? 0 : 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return Math.min(1, prev[b.length]! / a.length);
};
