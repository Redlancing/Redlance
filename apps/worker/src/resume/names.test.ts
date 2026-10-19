import { describe, expect, it } from "vitest";
import {
  cutPartialName,
  DEFAULT_GENERIC,
  findOrganisation,
  linkNamesClient,
  nameOccurs,
  removeNamedUrls,
  replaceNames,
  sharesNameWord,
  type ClientName,
} from "./names";

const n = (name: string, generic = "a retail client"): ClientName => ({
  name,
  generic,
});

describe("replaceNames", () => {
  it("replaces a name that is present", () => {
    expect(
      replaceNames("Built a site for Acme Corp", [n("Acme Corp")]),
    ).toMatchObject({
      text: "Built a site for a retail client",
      replaced: ["Acme Corp"],
    });
  });

  it("ignores a name that is absent, leaving the text unchanged", () => {
    expect(
      replaceNames("Built a site for a bakery", [n("Acme Corp")]),
    ).toMatchObject({
      text: "Built a site for a bakery",
      replaced: [],
    });
  });

  it("replaces several names", () => {
    const r = replaceNames("Shipped apps for Acme and Globex in 2023", [
      n("Acme", "a retailer"),
      n("Globex", "a logistics firm"),
    ]);
    expect(r.text).toBe(
      "Shipped apps for a retailer and a logistics firm in 2023",
    );
    expect(r.replaced).toEqual(["Acme", "Globex"]);
  });

  it("matches regardless of case and spacing", () => {
    expect(replaceNames("Work for ACME  corp.", [n("Acme Corp")]).text).toBe(
      "Work for a retail client.",
    );
    expect(replaceNames("Work for Acme\nCorp", [n(" acme corp ")]).text).toBe(
      "Work for a retail client",
    );
  });

  it("does not match inside a longer word", () => {
    const r = replaceNames("Moved to Acmeville; built Acme2 and AcmeCorp", [
      n("Acme"),
    ]);
    expect(r).toMatchObject({
      text: "Moved to Acmeville; built Acme2 and AcmeCorp",
      replaced: [],
    });
    // Punctuation is a boundary.
    expect(
      replaceNames("Acme's app (Acme)", [n("Acme", "a client")]).text,
    ).toBe("a client's app (a client)");
  });

  it("replaces the longest name first when names overlap", () => {
    const r = replaceNames("Acme Corp hired me; Acme later grew", [
      n("Acme", "the client"),
      n("Acme Corp", "a retail client"),
    ]);
    expect(r.text).toBe("a retail client hired me; the client later grew");
    expect(r.replaced).toEqual(["Acme", "Acme Corp"]);
    // A longer name that fails its boundary falls back to the shorter one.
    expect(
      replaceNames("Acme Corpus", [n("Acme", "X co"), n("Acme Corp")]).text,
    ).toBe("X co Corpus");
  });

  it("never puts another listed name back through a phrase", () => {
    const r = replaceNames("Built for Acme and Globex", [
      n("Acme", "a Globex partner"),
      n("Globex", "a shipper"),
    ]);
    expect(r.text).toBe("Built for a client and a shipper");
  });

  it("never replaces inside a phrase it just inserted", () => {
    // "agency" is a common word, so the phrase may hold it; the inserted text isn't matched again.
    const r = replaceNames("Built for Acme and Globex", [
      n("Acme", "an agency client"),
      n("agency", "a sector"),
      n("Globex", "a firm"),
    ]);
    expect(r.text).toBe("Built for an agency client and a firm");
    expect(r.replaced).toEqual(["Acme", "Globex"]);
  });

  it("escapes regex characters in names", () => {
    expect(replaceNames("Rebuilt C&A's store", [n("C&A")]).text).toBe(
      "Rebuilt a retail client's store",
    );
    expect(
      replaceNames("Ads for Yahoo! and Yahoo", [n("Yahoo!", "a portal")]).text,
    ).toBe("Ads for a portal and Yahoo");
    expect(
      replaceNames("Ran Node (UK) events", [n("Node (UK)", "a meetup")]).text,
    ).toBe("Ran a meetup events");
    expect(replaceNames("a.b.c and abc", [n("a.b.c", "x")]).text).toBe(
      "x and abc",
    );
  });

  it("replaces every occurrence in the line", () => {
    expect(
      replaceNames("Acme web, Acme app, ACME api", [n("Acme", "X")]).text,
    ).toBe("X web, X app, X api");
  });

  it("ignores names shorter than 2 characters", () => {
    expect(replaceNames("Plan B for X", [n("B"), n(" X ")])).toMatchObject({
      text: "Plan B for X",
      replaced: [],
    });
  });

  it('uses "a client" for an empty or bad replacement phrase, so the name still goes', () => {
    const cases: [string, string][] = [
      ["", DEFAULT_GENERIC],
      ["   ", DEFAULT_GENERIC],
      // A phrase that contains the name would keep it.
      ["Acme's retail arm", DEFAULT_GENERIC],
      ["acme", DEFAULT_GENERIC],
      // Links, emails, markup and line breaks aren't generic phrases.
      ["see acme.example.com/about", DEFAULT_GENERIC],
      ["https://x.io", DEFAULT_GENERIC],
      ["bob@x.io", DEFAULT_GENERIC],
      ["<b>client</b>", DEFAULT_GENERIC],
      ["a\nclient", DEFAULT_GENERIC],
      // Longer than 40 characters.
      [
        "a very large multinational retail and logistics group",
        DEFAULT_GENERIC,
      ],
      ["  a  retail   client ", "a retail client"],
    ];
    for (const [generic, want] of cases)
      expect(
        replaceNames("Built for Acme.", [{ name: "Acme", generic }]).text,
        generic,
      ).toBe(`Built for ${want}.`);
  });

  it("reports each replaced name with the phrase actually used", () => {
    const r = replaceNames("Built for Acme and Globex", [
      n("Globex", "https://globex.example"),
      n("Acme", "a shop"),
      n("Initech", "a bank"),
    ]);
    expect(r.pairs).toEqual([
      { name: "Globex", generic: DEFAULT_GENERIC },
      { name: "Acme", generic: "a shop" },
    ]);
  });

  it("keeps the first phrase when a name is listed twice", () => {
    const r = replaceNames("Built for Acme", [
      n("Acme", "a shop"),
      n("ACME", "a store"),
    ]);
    expect(r).toMatchObject({ text: "Built for a shop", replaced: ["Acme"] });
  });

  it("handles letters outside ASCII as word characters", () => {
    expect(
      replaceNames("Für Müller GmbH und Müllerei", [
        n("Müller", "einen Kunden"),
      ]).text,
    ).toBe("Für einen Kunden GmbH und Müllerei");
  });

  it("returns the text unchanged with no names", () => {
    expect(replaceNames("Anything", [])).toMatchObject({
      text: "Anything",
      replaced: [],
    });
  });
});

describe("nameOccurs", () => {
  it("is a whole-word, case- and space-insensitive check", () => {
    expect(nameOccurs("Worked at ACME  Corp", "Acme Corp")).toBe(true);
    expect(nameOccurs("Worked in Acmeville", "Acme")).toBe(false);
    expect(nameOccurs("Worked at C&A", "C&A")).toBe(true);
    expect(nameOccurs("anything", " ")).toBe(false);
    expect(nameOccurs("a b", "a")).toBe(false);
  });
});

describe("replaceNames: phrases that share a word with a name", () => {
  it('uses "a client" when the phrase shares a word of 3+ letters with any listed name', () => {
    const cases: [string, ClientName[]][] = [
      ["Acme's agency", [n("Acme Realty", "Acme's agency")]],
      ["the Acme group", [n("Acme Realty", "the Acme group")]],
      ["ACME’s brokerage", [n("Acme Realty", "ACME’s brokerage")]],
      // A name listed for the entry but not in this line still can't come back.
      [
        "a Globex partner",
        [n("Acme Realty", "a Globex partner"), n("Globex Corp", "a shipper")],
      ],
      // Squashed into one word, like a domain.
      [
        "a realtor at acmerealty",
        [n("Acme Realty", "a realtor at acmerealty")],
      ],
    ];
    for (const [phrase, names] of cases)
      expect(
        replaceNames("Built for Acme Realty", names).text,
        phrase,
      ).not.toMatch(/acme|globex/i);
  });

  it("allows common words and words under 3 letters", () => {
    expect(
      replaceNames("Built for Bright Studio", [
        n("Bright Studio", "a design studio"),
      ]).text,
    ).toBe("Built for a design studio");
    expect(
      replaceNames("Built for XY Labs", [n("XY Labs", "an xy research lab")])
        .text,
    ).toBe("Built for an xy research lab");
  });
});

describe("sharesNameWord", () => {
  it("compares case-folded words without possessives", () => {
    expect(sharesNameWord("Acme's agency", ["Acme Realty"])).toBe(true);
    expect(
      sharesNameWord("Globex’s logistics arm", ["Globex Corporation"]),
    ).toBe(true);
    expect(sharesNameWord("a REALTY firm", ["Acme Realty"])).toBe(true);
    expect(sharesNameWord("a real-estate agency", ["Acme Realty"])).toBe(false);
    expect(sharesNameWord("a design studio", ["Bright Studio"])).toBe(false);
    expect(sharesNameWord("anything", [])).toBe(false);
  });
});

describe("findOrganisation", () => {
  const block =
    "Web developer — Acme Realty, Jan 2020 – Present\n- Built the site";
  it("returns the name as the block writes it", () => {
    expect(findOrganisation(block, "Acme Realty")).toBe("Acme Realty");
    expect(findOrganisation(block, "acme  realty")).toBe("Acme Realty");
  });
  it("retries without a legal suffix and punctuation", () => {
    for (const org of [
      "Acme Realty Inc.",
      "Acme Realty, Inc",
      "Acme Realty LLC",
      "Acme Realty Ltd.",
      "Acme Realty GmbH",
      "Acme Realty Pvt. Ltd",
      "Acme Realty Co.",
      "Acme Realty Corp",
    ])
      expect(findOrganisation(block, org), org).toBe("Acme Realty");
  });
  it("falls back to the longest leading run of words in the block", () => {
    expect(findOrganisation(block, "Acme Realty Group International")).toBe(
      "Acme Realty",
    );
    expect(findOrganisation("Engineer at Acme, 2020", "Acme Holdings")).toBe(
      "Acme",
    );
  });
  it("never settles on a short or common leading word", () => {
    expect(
      findOrganisation("Built global tools, 2020", "Global Widgets Ltd"),
    ).toBeNull();
    expect(findOrganisation("Built for the IT team", "IT Partners")).toBeNull();
    expect(findOrganisation(block, "Initech")).toBeNull();
  });
});

describe("linkNamesClient and removeNamedUrls", () => {
  it("matches a host (without dots, hyphens and the TLD) holding a name", () => {
    expect(
      linkNamesClient("https://acmerealty.com/listings", ["Acme Realty"]),
    ).toBe(true);
    expect(linkNamesClient("acme-realty.vercel.app", ["Acme Realty"])).toBe(
      true,
    );
    expect(
      linkNamesClient("https://www.AcmeRealty.co.uk", ["acme realty"]),
    ).toBe(true);
    expect(
      linkNamesClient("https://github.com/jane/shop", ["Acme Realty"]),
    ).toBe(false);
    expect(linkNamesClient("https://acme.com", ["XY"])).toBe(false);
  });
  it("matches a path holding a name", () => {
    expect(
      linkNamesClient("https://github.com/jane/acme-realty-site", [
        "Acme Realty",
      ]),
    ).toBe(true);
  });
  it("removes such links and bare domains from text, and keeps others", () => {
    expect(removeNamedUrls("Launched acmerealty.com", ["Acme Realty"])).toBe(
      "Launched",
    );
    expect(
      removeNamedUrls(
        "Launched https://www.acmerealty.com/new in 6 weeks; code at github.com/jane/shop",
        ["Acme Realty"],
      ),
    ).toBe("Launched in 6 weeks; code at github.com/jane/shop");
    expect(removeNamedUrls("Built with Node.js and React", ["Node"])).toBe(
      "Built with Node.js and React",
    );
  });
});

describe("cutPartialName", () => {
  it("cuts a line that ends in the start of a name", () => {
    expect(cutPartialName("Cut page load for Acme Rea", ["Acme Realty"])).toBe(
      "Cut page load",
    );
    expect(cutPartialName("Cut page load for acme", ["Acme Realty"])).toBe(
      "Cut page load",
    );
    expect(cutPartialName("Built tools for Glo", ["Globex"])).toBe(
      "Built tools",
    );
  });
  it("leaves complete names, short tails and other lines alone", () => {
    expect(cutPartialName("Built for Acme Realty", ["Acme Realty"])).toBe(
      "Built for Acme Realty",
    );
    expect(cutPartialName("Built for Ac", ["Acme Realty"])).toBe(
      "Built for Ac",
    );
    expect(cutPartialName("Built for Acmeville", ["Acme Realty"])).toBe(
      "Built for Acmeville",
    );
    expect(cutPartialName("Cut page load.", ["Acme Realty"])).toBe(
      "Cut page load.",
    );
    // The tail is itself a listed name (it gets replaced, not cut).
    expect(
      cutPartialName("Built for Acme Realty", [
        "Acme Realty Inc.",
        "Acme Realty",
      ]),
    ).toBe("Built for Acme Realty");
  });
});
