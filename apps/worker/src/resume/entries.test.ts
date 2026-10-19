import { describe, expect, it } from "vitest";
import { MAX_BLOCK_CHARS, MAX_BLOCKS, splitEntries } from "./entries";

const NOW = new Date("2026-10-17T00:00:00Z");
const lines = (...l: string[]) => l.join("\n");
const ids = (blocks: { id: string }[]) => blocks.map((b) => b.id);
const firstLines = (blocks: { text: string }[]) =>
  blocks.map((b) => b.text.split("\n")[0]);

// The Experience section of a typical PDF resume: two-line headers, "•" bullets,
// a wrapped bullet, a tab, a one-line header and several date formats.
const EXPERIENCE = lines(
  "Senior Software Engineer",
  "Finlytics Pvt Ltd, Bengaluru\tJan 2021 – Present",
  "• Led a team of 4 building a React + Node.js payments dashboard used by 300 merchants.",
  "• Cut API latency by 40% by moving reports to PostgreSQL materialised views.",
  "Software Engineer | ShopKart | 06/2018 - 12/2020",
  "• Built the checkout flow in Vue.js and Stripe,",
  "handling 10k orders a day.",
  "• Wrote Python scripts to sync inventory.",
  "Freelance Web Developer — Sept. 2017 to May 2018",
  "- Built WordPress sites for three local restaurants.",
);

const PROJECTS = lines(
  "Shopfront — Next.js storefront, 2023",
  "• Headless Shopify store for a bakery; github.com/priyadev/shopfront",
  "• Lighthouse score 98. Live at https://shopfront.vercel.app.",
  "TaskFlow (2022)",
  "• React Native todo app with offline sync. www.taskflow.app",
);

describe("splitEntries: main rules", () => {
  it("splits at a head line after bullets", () => {
    const blocks = splitEntries(EXPERIENCE, "experience", { now: NOW });
    expect(firstLines(blocks)).toEqual([
      "Senior Software Engineer",
      "Software Engineer | ShopKart | 06/2018 - 12/2020",
      "Freelance Web Developer — Sept. 2017 to May 2018",
    ]);
    expect(blocks.map((b) => b.text).join("\n")).toBe(EXPERIENCE);
  });

  it("keeps a two-line header in one block (title line + company/date line)", () => {
    const [e1] = splitEntries(EXPERIENCE, "experience", { now: NOW });
    expect(e1!.text).toBe(
      lines(
        "Senior Software Engineer",
        "Finlytics Pvt Ltd, Bengaluru\tJan 2021 – Present",
        "• Led a team of 4 building a React + Node.js payments dashboard used by 300 merchants.",
        "• Cut API latency by 40% by moving reports to PostgreSQL materialised views.",
      ),
    );
  });

  it("keeps a header whose company line comes after the date line", () => {
    const blocks = splitEntries(
      lines(
        "Content Writer (Contract)    02/2023 – 09/2024",
        "Acme Analytics, remote",
        "1) Wrote 60 long-form SEO articles that doubled organic traffic.",
        "2) Edited product docs.",
        "Marketing Intern\tJun 2022 – Dec 2022",
        "Bloom Agency",
        "- Drafted social posts for 5 clients.",
      ),
      "experience",
      { now: NOW },
    );
    expect(firstLines(blocks)).toEqual([
      "Content Writer (Contract)    02/2023 – 09/2024",
      "Marketing Intern\tJun 2022 – Dec 2022",
    ]);
    expect(blocks[1]!.text).toContain("Bloom Agency");
  });

  it("keeps a wrapped bullet line in its block", () => {
    const blocks = splitEntries(EXPERIENCE, "experience", { now: NOW });
    expect(blocks[1]!.text).toContain("Stripe,\nhandling 10k orders a day.");
    expect(blocks).toHaveLength(3);
  });

  it("splits at blank lines and ignores extra blank lines", () => {
    const blocks = splitEntries(
      lines(
        "",
        "Designer, Bloom 2021 - 2022",
        "Logos and brand kits",
        "",
        "",
        "Illustrator, Fable 2019 - 2021",
        "Book covers",
        "",
      ),
      "experience",
      { now: NOW },
    );
    expect(blocks.map((b) => b.text)).toEqual([
      "Designer, Bloom 2021 - 2022\nLogos and brand kits",
      "Illustrator, Fable 2019 - 2021\nBook covers",
    ]);
  });

  it("starts a new experience block at a second dated head line", () => {
    const blocks = splitEntries(
      lines(
        "Data Analyst, Northwind 2022 – Present",
        "Built Tableau dashboards for the sales team",
        "Junior Analyst, Contoso 2020 – 2022",
        "Cleaned CRM data in Excel",
      ),
      "experience",
      { now: NOW },
    );
    expect(firstLines(blocks)).toEqual([
      "Data Analyst, Northwind 2022 – Present",
      "Junior Analyst, Contoso 2020 – 2022",
    ]);
  });

  it("moves a title line that sits above a dated line into the new block", () => {
    const blocks = splitEntries(
      lines(
        "Senior Developer",
        "Acme Corp, Jan 2021 – Present",
        "Built the billing system and led two juniors.",
        "Developer",
        "Beta Ltd, 2018 – 2020",
        "Maintained the Rails monolith.",
      ),
      "experience",
      { now: NOW },
    );
    expect(blocks.map((b) => b.text)).toEqual([
      "Senior Developer\nAcme Corp, Jan 2021 – Present\nBuilt the billing system and led two juniors.",
      "Developer\nBeta Ltd, 2018 – 2020\nMaintained the Rails monolith.",
    ]);
  });

  it("does not split projects at a second dated line", () => {
    const blocks = splitEntries(
      lines("Shopfront 2021 - 2022", "Next.js store", "Relaunch 2023 - 2024"),
      "projects",
      { now: NOW },
    );
    expect(blocks).toHaveLength(1);
  });

  it("treats numbered lines, odd bullet glyphs and long paragraphs as content", () => {
    const long =
      "A headless storefront for a bakery that takes orders online, sends them to the kitchen tablet and texts customers when the order is ready.";
    expect(long.length).toBeGreaterThan(120);
    const blocks = splitEntries(
      lines(
        "Bakery Store",
        long,
        "Recipe Box",
        "▪ Saves recipes offline",
        "◦ Shares lists",
        "Budget Bot",
        "1. Telegram bot for spending",
        "Pixel Pets",
        " Unity game jam entry",
      ),
      "projects",
      { now: NOW },
    );
    expect(firstLines(blocks)).toEqual([
      "Bakery Store",
      "Recipe Box",
      "Budget Bot",
      "Pixel Pets",
    ]);
  });

  it("reads DOCX text, where every paragraph is followed by a blank line", () => {
    // mammoth adds "\n\n" after each paragraph and drops the list bullets;
    // an empty paragraph between jobs gives two blank lines.
    const docx = [
      "Senior Software Engineer",
      "Finlytics, Bengaluru\tJan 2021 – Present",
      "Led a team of 4 building a payments dashboard.",
      "Cut API latency by 40%.",
      "",
      "Software Engineer",
      "ShopKart, 06/2018 - 12/2020",
      "Built the checkout flow.",
    ].join("\n\n");
    const blocks = splitEntries(docx, "experience", { now: NOW });
    expect(firstLines(blocks)).toEqual([
      "Senior Software Engineer",
      "Software Engineer",
    ]);
    expect(blocks[0]!.text).toContain("Cut API latency by 40%.");

    // Without the empty paragraph, the second dated line still starts a block
    // and takes its title with it.
    const tight = docx.replace("\n\n\n\n", "\n\n");
    expect(firstLines(splitEntries(tight, "experience", { now: NOW }))).toEqual(
      ["Senior Software Engineer", "Software Engineer"],
    );
  });

  it("returns no blocks for an empty section", () => {
    expect(splitEntries("", "experience")).toEqual([]);
    expect(splitEntries("\n \n", "projects")).toEqual([]);
  });
});

describe("splitEntries: fallbacks", () => {
  it("falls back to date lines when there are no blank lines or bullets", () => {
    // DOCX-style: one long paragraph per job, so the main rules find one block.
    const a =
      "Senior Developer at Acme Corp, Jan 2021 – Present: built the billing system in Go and Postgres, led two junior developers and cut invoice errors by 30 percent.";
    const b =
      "Developer at Beta Ltd, 2018 – 2020: maintained the Rails monolith, moved the deploys to Docker and wrote the on-call runbook for the whole team of eight.";
    const blocks = splitEntries(lines(a, b), "experience", { now: NOW });
    expect(blocks.map((x) => x.text)).toEqual([a, b]);
  });

  it("falls back to date lines when every entry is a bullet", () => {
    const blocks = splitEntries(
      lines(
        "• Video editor, Brightframe, 2022 – now: YouTube edits",
        "• Motion designer, Pixelhaus, 2019 – 2022: explainers",
      ),
      "experience",
      { now: NOW },
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.range?.start.year).toBe(2019);
  });

  it("falls back to one block when nothing splits", () => {
    const text = lines(
      "Freelance writer for SaaS blogs and newsletters, mostly B2B, since leaving my agency job a few years back to work for myself.",
      "Clients include analytics, HR and payroll startups across Europe and the US, and I write about two posts a week for each.",
    );
    const blocks = splitEntries(text, "experience", { now: NOW });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe(text);
    expect(blocks[0]!.range).toBeNull();
  });

  it("with no headings, splits the whole text at date lines and drops the lines above the first job", () => {
    const text = lines(
      "Marco Rossi",
      "Video editor and motion designer, Milan",
      "marco@rossi.studio · +39 333 123 4567",
      "I edit YouTube videos and ads for brands and creators.",
      "Lead Video Editor, Brightframe Media",
      "March 2022 - now",
      "Edited 200+ YouTube videos in Premiere Pro and After Effects.",
      "Motion Designer at Pixelhaus 2019-2022",
      "Made explainer animations for fintech startups.",
      "Junior Editor, Studio Nove 2017 – 2019",
      "Premiere Pro, After Effects, DaVinci Resolve, Photoshop",
      "Diploma in Film Editing, 2016 - 2017",
    );
    const blocks = splitEntries(text, "experience", {
      headed: false,
      now: NOW,
    });
    expect(firstLines(blocks)).toEqual([
      "Lead Video Editor, Brightframe Media",
      "Motion Designer at Pixelhaus 2019-2022",
      "Junior Editor, Studio Nove 2017 – 2019",
    ]);
    expect(blocks[0]!.text).not.toContain("marco@rossi.studio");
    expect(blocks[0]!.range).toEqual({
      start: { year: 2022, month: 3 },
      end: null,
      current: true,
    });
  });

  it("with no headings and no dates, the whole text is one block", () => {
    const text = "Sam Lee\nCopywriter\nI write landing pages.";
    expect(
      splitEntries(text, "experience", { headed: false }).map((b) => b.text),
    ).toEqual([text]);
  });

  it("with no headings, there are no project blocks", () => {
    expect(splitEntries(PROJECTS, "projects", { headed: false })).toEqual([]);
  });

  it(`caps at ${MAX_BLOCKS} blocks, the rest joins the last`, () => {
    const many = Array.from(
      { length: 15 },
      (_, i) => `Project ${i + 1}\n- did thing ${i + 1}`,
    );
    const blocks = splitEntries(many.join("\n"), "projects", { now: NOW });
    expect(blocks).toHaveLength(MAX_BLOCKS);
    expect(blocks[11]!.text).toBe(many.slice(11).join("\n"));
    expect(blocks[11]!.id).toBe("P12");
  });

  it(`caps a block at ${MAX_BLOCK_CHARS} characters`, () => {
    const bullets = Array.from(
      { length: 80 },
      (_, i) => `• Wrote article number ${i} about SEO for B2B SaaS teams`,
    );
    const blocks = splitEntries(
      lines(
        "Content Writer, Acme 2020 - 2024",
        ...bullets,
        "Editor, Beta 2018 - 2020",
        "• Edited",
      ),
      "experience",
      { now: NOW },
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.text.length).toBe(MAX_BLOCK_CHARS);
    expect(blocks[1]!.text).toBe("Editor, Beta 2018 - 2020\n• Edited");
  });
});

describe("splitEntries: ids, dates, years and links", () => {
  it("numbers blocks E1.. and P1..", () => {
    expect(ids(splitEntries(EXPERIENCE, "experience", { now: NOW }))).toEqual([
      "E1",
      "E2",
      "E3",
    ]);
    expect(ids(splitEntries(PROJECTS, "projects", { now: NOW }))).toEqual([
      "P1",
      "P2",
    ]);
  });

  it("attaches the first date range to experience blocks, without year or links", () => {
    const blocks = splitEntries(EXPERIENCE, "experience", { now: NOW });
    expect(blocks.map((b) => b.range)).toEqual([
      { start: { year: 2021, month: 1 }, end: null, current: true },
      {
        start: { year: 2018, month: 6 },
        end: { year: 2020, month: 12 },
        current: false,
      },
      {
        start: { year: 2017, month: 9 },
        end: { year: 2018, month: 5 },
        current: false,
      },
    ]);
    for (const b of blocks) {
      expect(b.year).toBeNull();
      expect(b.links).toEqual([]);
    }
  });

  it("attaches the project year: from the range, otherwise a plain year, otherwise null", () => {
    const blocks = splitEntries(
      lines(
        "Habit Tracker, Mar 2020 – Jun 2021",
        "- Flutter app, 2019 prototype",
        "Portfolio Site, 2024 – present",
        "- Astro",
        "Shopfront — Next.js storefront, 2021, relaunched 2023",
        "- 2000+ users, $1999 budget",
        "Recipe Box",
        "- Saves recipes offline",
      ),
      "projects",
      { now: NOW },
    );
    expect(blocks.map((b) => b.year)).toEqual([2021, 2026, 2023, null]);
    expect(blocks[0]!.range?.end).toEqual({ year: 2021, month: 6 });
    expect(blocks[3]!.range).toBeNull();
  });

  it("finds the links of each project block", () => {
    const blocks = splitEntries(PROJECTS, "projects", { now: NOW });
    expect(blocks[0]!.year).toBe(2023);
    expect(blocks[0]!.links).toEqual([
      "https://github.com/priyadev/shopfront",
      "https://shopfront.vercel.app/",
    ]);
    expect(blocks[1]!.year).toBe(2022);
    expect(blocks[1]!.links).toEqual(["https://www.taskflow.app/"]);
  });
});
