const norm = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function hasEvidence(text: string, quote: string | undefined): boolean {
  if (!quote) return false;
  const q = norm(quote);
  return q.length >= 3 && norm(text).includes(q);
}
