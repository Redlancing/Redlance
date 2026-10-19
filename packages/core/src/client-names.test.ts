import { describe, expect, it } from "vitest";
import { NEUTRAL_ORGANISATION, scrubOrganisations } from "./client-names";

// The rest of client-names.ts is tested in apps/worker/src/resume/names.test.ts (through the
// worker's re-export), where it started.

const ACME = {
  organisation: "Acme Realty",
  description: "a real-estate agency",
};

describe("scrubOrganisations", () => {
  it("replaces the organisation in a title with its description", () => {
    expect(scrubOrganisations("Senior dev at Acme Realty", [ACME])).toBe(
      "Senior dev at a real-estate agency",
    );
  });

  it("ignores case and spacing, and keeps possessives and punctuation", () => {
    expect(
      scrubOrganisations(
        "Rebuilt ACME   realty's listings (for acme realty, mostly).",
        [ACME],
      ),
    ).toBe(
      "Rebuilt a real-estate agency's listings (for a real-estate agency, mostly).",
    );
  });

  it("only matches whole words", () => {
    expect(
      scrubOrganisations("Worked on AcmeRealtyCRM", [
        { organisation: "Acme", description: "a retailer" },
      ]),
    ).toBe("Worked on AcmeRealtyCRM");
    expect(
      scrubOrganisations("Built Acme's shop", [
        { organisation: "Acme", description: "a retailer" },
      ]),
    ).toBe("Built a retailer's shop");
  });

  it("also replaces the name without its legal suffix", () => {
    expect(
      scrubOrganisations("Built the Bright Studio site", [
        { organisation: "Bright Studio Ltd.", description: "a design firm" },
      ]),
    ).toBe("Built the a design firm site");
  });

  it("uses a neutral phrase when there's no description or it holds the name", () => {
    expect(
      scrubOrganisations("Ran Acme Realty's blog", [
        { organisation: "Acme Realty", description: "" },
      ]),
    ).toBe(`Ran ${NEUTRAL_ORGANISATION}'s blog`);
    expect(
      scrubOrganisations("Ran Acme's blog", [
        { organisation: "Acme", description: "Acme's property arm" },
      ]),
    ).toBe(`Ran ${NEUTRAL_ORGANISATION}'s blog`);
  });

  it("handles several organisations, longest first, and leaves text without them alone", () => {
    const orgs = [
      { organisation: "Acme", description: "a retailer" },
      ACME,
      { organisation: null, description: "freelance clients" },
    ];
    expect(scrubOrganisations("Acme Realty, then Acme", orgs)).toBe(
      "a real-estate agency, then a retailer",
    );
    const plain = "Built listing pages";
    expect(scrubOrganisations(plain, orgs)).toBe(plain);
    expect(scrubOrganisations(plain, [])).toBe(plain);
  });
});
