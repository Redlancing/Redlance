import { describe, expect, it } from "vitest";
import { DRAFT_EXAMPLES, LINK_PLACEHOLDER } from "./examples";
import type { Evidence } from "./types";
import { validateDraft } from "./validate";

// Case 14: every hand-written example passes validateDraft against the facts it was written
// from (its own fake evidence), with at most one link. Kept apart from examples.test.ts because
// validate.ts is built in Phase 4.

const LINK = "https://example.com/work";

const evidenceFor = (facts: string): Evidence => ({
  project: null,
  role: null,
  skills: [],
  allowedLinks: [LINK],
  rateNote: { mention: false },
  availability: null,
  redFlags: [],
  broad: false,
  employerNamesAllowed: false,
  organisationNames: [],
  evidenceText: facts,
  summary: { projectTitle: null, roleTitle: null, skills: [] },
  citedProjectIds: [],
});

// The comment-only and DM-only checks: an example is one channel, so the other is left empty.
const ONE_CHANNEL_OK = new Set(["EMPTY", "DM_TOO_SHORT"]);

describe("every example passes validateDraft", () => {
  for (const e of DRAFT_EXAMPLES) {
    it(e.id, () => {
      const text = e.text.replaceAll(LINK_PLACEHOLDER, LINK);
      const draft =
        e.channel === "dm"
          ? { comment: "", dm: text }
          : { comment: text, dm: "" };
      const problems = validateDraft(draft, evidenceFor(e.facts), {
        postText: e.postExcerpt,
        target: { dmMin: 60, dmMax: 150 },
      }).filter(
        (p) => !(e.channel === "comment" && ONE_CHANNEL_OK.has(p.code)),
      );
      expect(problems).toEqual([]);
      expect(text.split(LINK).length - 1).toBeLessThanOrEqual(1);
    });
  }
});
