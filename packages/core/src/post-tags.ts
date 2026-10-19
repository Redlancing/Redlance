import type { PreKind } from "./job-post";

// Title-tag conventions seen across hiring subreddits (docs/ingestion/research). A free first
// guess only: untagged posts stay "unknown" and the analyser decides. The earliest tag wins,
// so "[For Hire] … hiring soon" is for hire.

const HIRING = [
  // [Hiring], [HIRING/COLLAB], [Task], [Paid], [PAID – $20/hr], [Buying], [Patron], [LFC], [Seeking]
  /[[({]\s*(?:now\s+)?(?:hiring|task|paid(?:\s+task|\s+gig|\s+request)?|buying|patron|client|lfc|seeking(?!\s+(?:work|clients?|commissions?|projects?|jobs?|gigs?)\b)(?:\s+artist)?|job\s+offer)\b/giu,
  // "Hiring: …", "HIRING - …", "Now hiring …", "We're hiring …", "URGENT HIRING …" at the start
  /^[^\p{L}\p{N}]*(?:(?:we'?re|we\s+are|now|urgent(?:ly)?)\s+)?hiring\b/giu,
  // "PAID - 2D Art" (gameDevClassifieds style) at the start
  /^[^\p{L}\p{N}]*paid\s*[-–—:|]/giu,
];

const FOR_HIRE = [
  // [For Hire], {For Hire}, [FH], [Hire Me], [Offer], [Offering], [Selling], [Available], [Artist], [Commissions Open]
  /[[({]\s*(?:for[\s-]*hire|fh|hire\s+me|offer(?:ing)?|selling|available|artist(?:\s+for\s+hire)?|seeking\s+(?:work|clients?|commissions?|projects?|jobs?|gigs?)|commissions?\s+(?:are\s+)?open|open\s+for\s+commissions?)\b/giu,
  /^[^\p{L}\p{N}]*(?:for[\s-]*hire|hire\s+me)\b/giu,
  // "Commissions open!" as an announcement at the start, not "Anyone with commissions open?"
  /^[^\p{L}\p{N}]*(?:my\s+)?commissions?\s+(?:are\s+)?(?:now\s+)?open\b/giu,
];

function firstIndex(title: string, patterns: RegExp[]): number {
  let best = -1;
  for (const re of patterns) {
    re.lastIndex = 0;
    const m = re.exec(title);
    if (m && (best < 0 || m.index < best)) best = m.index;
  }
  return best;
}

export function preKindFromTitle(title: string): PreKind {
  const t = title.normalize("NFKC");
  const h = firstIndex(t, HIRING);
  const f = firstIndex(t, FOR_HIRE);
  if (h < 0 && f < 0) return "unknown";
  if (h < 0) return "for_hire";
  if (f < 0) return "hiring";
  return h < f ? "hiring" : "for_hire";
}
