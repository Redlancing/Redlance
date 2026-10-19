import { describe, expect, it } from "vitest";
import { CATEGORY_IDS } from "../taxonomy";
import { BANNED_PHRASES } from "./banned";
import { DRAFT_EXAMPLES, LINK_PLACEHOLDER } from "./examples";
import { sentenceCount, wordCount } from "./text";

const count = (s: string, sub: string) => s.split(sub).length - 1;

describe("DRAFT_EXAMPLES", () => {
  it("has unique ids and valid job types", () => {
    const ids = DRAFT_EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of DRAFT_EXAMPLES)
      expect([...CATEGORY_IDS, "general"]).toContain(e.jobType);
  });

  // Case 15: the 4 busiest job types have ≥ 1 comment and ≥ 2 DMs; general has ≥ 2 of each.
  it("covers the busiest job types and general", () => {
    const n = (jobType: string, channel: string) =>
      DRAFT_EXAMPLES.filter(
        (e) => e.jobType === jobType && e.channel === channel,
      ).length;
    for (const t of ["development", "video", "design", "writing"]) {
      expect(n(t, "comment"), t).toBeGreaterThanOrEqual(1);
      expect(n(t, "dm"), t).toBeGreaterThanOrEqual(2);
    }
    expect(n("general", "comment")).toBeGreaterThanOrEqual(2);
    expect(n("general", "dm")).toBeGreaterThanOrEqual(2);
  });

  it("DMs are 60-120 words with exactly one {link}; comments have none", () => {
    for (const e of DRAFT_EXAMPLES) {
      if (e.channel === "dm") {
        const w = wordCount(e.text);
        expect(w, e.id).toBeGreaterThanOrEqual(60);
        expect(w, e.id).toBeLessThanOrEqual(120);
        expect(count(e.text, LINK_PLACEHOLDER), e.id).toBe(1);
      } else {
        expect(e.text.length, e.id).toBeLessThanOrEqual(300);
        expect(sentenceCount(e.text), e.id).toBeLessThanOrEqual(3);
        expect(e.text, e.id).not.toContain(LINK_PLACEHOLDER);
      }
      expect(e.text, e.id).not.toMatch(/https?:\/\/|github\.com/i);
    }
  });

  it("uses no banned phrase", () => {
    for (const e of DRAFT_EXAMPLES)
      for (const p of BANNED_PHRASES)
        expect(e.text.toLowerCase(), `${e.id}: ${p}`).not.toContain(p);
  });

  it("includes a DM-only example and a send-your-rate example", () => {
    const dmOnly = DRAFT_EXAMPLES.filter((e) =>
      /dm (me )?only/i.test(e.postExcerpt),
    );
    expect(dmOnly.length).toBeGreaterThanOrEqual(1);
    const rate = DRAFT_EXAMPLES.filter(
      (e) => /rate/i.test(e.postExcerpt) && /send|include/i.test(e.postExcerpt),
    );
    // One where the posted budget fits (the rate line allows it), one with no rate line.
    expect(rate.some((e) => /budget works/i.test(e.text))).toBe(true);
    expect(rate.some((e) => /quote/i.test(e.text))).toBe(true);
  });
});
