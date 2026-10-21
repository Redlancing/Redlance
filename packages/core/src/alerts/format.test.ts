import { describe, expect, it } from "vitest";
import {
  alertLinks,
  budgetLabel,
  telegramAlert,
  type AlertItem,
} from "./format";

const now = new Date("2026-10-20T12:00:00Z");
const origin = "https://redlance.app";
const item = (over: Partial<AlertItem> = {}): AlertItem => ({
  matchId: "0192f000-0000-7000-8000-000000000001",
  score: 84,
  title: "[Hiring] Next.js dev to fix Stripe checkout",
  community: "forhire",
  url: "https://www.reddit.com/r/forhire/comments/abc/next/",
  postedAt: new Date(now.getTime() - 6 * 60_000),
  budgetText: "$400–600",
  reason: "Strong fit: Next.js, Stripe, Postgres; budget above your rate.",
  ...over,
});

describe("telegramAlert, one match", () => {
  it("renders the tg@1 single alert exactly", () => {
    const msg = telegramAlert([item()], origin, now);
    expect(msg.text).toBe(
      [
        "🎯 <b>84</b> · <b>Next.js dev to fix Stripe checkout</b>",
        "r/forhire · posted 6 min ago · $400–600",
        "Strong fit: Next.js, Stripe, Postgres; budget above your rate.",
      ].join("\n"),
    );
    expect(msg.replyMarkup).toEqual({
      inline_keyboard: [
        [
          {
            text: "✍️ Draft reply",
            url: "https://redlance.app/feed/0192f000-0000-7000-8000-000000000001",
          },
          {
            text: "🔗 Open post",
            url: "https://www.reddit.com/r/forhire/comments/abc/next/",
          },
        ],
      ],
    });
  });

  it("escapes HTML in post text", () => {
    const msg = telegramAlert(
      [
        item({
          title: "<script>alert(1)</script> & co",
          reason: "Uses <b>React</b> & Node",
          community: "for<hire>",
        }),
      ],
      origin,
      now,
    );
    expect(msg.text).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; co",
    );
    expect(msg.text).toContain("Uses &lt;b&gt;React&lt;/b&gt; &amp; Node");
    expect(msg.text).toContain("r/for&lt;hire&gt;");
    expect(msg.text).not.toContain("<script>");
  });

  it("leaves out a missing budget", () => {
    const msg = telegramAlert([item({ budgetText: null })], origin, now);
    expect(msg.text.split("\n")[1]).toBe("r/forhire · posted 6 min ago");
  });

  it("drops the Open post button for a non-Reddit URL", () => {
    for (const url of [
      "https://evil.example/r/x",
      "http://www.reddit.com/r/x/comments/1/",
      "javascript:alert(1)",
      "https://www.reddit.com.evil.example/r/x",
    ]) {
      const msg = telegramAlert([item({ url })], origin, now);
      expect(msg.replyMarkup.inline_keyboard[0]).toHaveLength(1);
      expect(msg.replyMarkup.inline_keyboard[0]![0]!.text).toBe(
        "✍️ Draft reply",
      );
    }
  });

  it("shortens very long titles", () => {
    const msg = telegramAlert([item({ title: "x".repeat(400) })], origin, now);
    const firstLine = msg.text.split("\n")[0]!;
    expect(firstLine).toContain("x".repeat(119) + "…");
    expect(firstLine).not.toContain("x".repeat(121));
  });

  it("formats post age", () => {
    const at = (min: number) =>
      telegramAlert(
        [item({ postedAt: new Date(now.getTime() - min * 60_000) })],
        origin,
        now,
      ).text.split("\n")[1];
    expect(at(0)).toContain("posted just now");
    expect(at(59)).toContain("posted 59 min ago");
    expect(at(60)).toContain("posted 1 h ago");
    expect(at(60 * 30)).toContain("posted 1 d ago");
  });
});

describe("telegramAlert, several matches", () => {
  it("renders a list with a draft link per match and one app button", () => {
    const items = [
      item(),
      item({
        matchId: "0192f000-0000-7000-8000-000000000002",
        score: 77,
        title: "Logo for a coffee shop",
        community: "HungryArtists",
        budgetText: null,
        reason: "Matches your logo design work.",
      }),
      item({
        matchId: "0192f000-0000-7000-8000-000000000003",
        score: 71,
        title: "Fix my <Shopify> theme",
        reason: "Shopify & Liquid.",
      }),
    ];
    const msg = telegramAlert(items, origin, now);
    expect(msg.text).toBe(
      [
        "🎯 <b>3 new matches</b>",
        "",
        '<b>84</b> · <a href="https://redlance.app/feed/0192f000-0000-7000-8000-000000000001">Next.js dev to fix Stripe checkout</a>',
        "r/forhire · posted 6 min ago · $400–600",
        "Strong fit: Next.js, Stripe, Postgres; budget above your rate.",
        "",
        '<b>77</b> · <a href="https://redlance.app/feed/0192f000-0000-7000-8000-000000000002">Logo for a coffee shop</a>',
        "r/HungryArtists · posted 6 min ago",
        "Matches your logo design work.",
        "",
        '<b>71</b> · <a href="https://redlance.app/feed/0192f000-0000-7000-8000-000000000003">Fix my &lt;Shopify&gt; theme</a>',
        "r/forhire · posted 6 min ago · $400–600",
        "Shopify &amp; Liquid.",
      ].join("\n"),
    );
    expect(msg.replyMarkup).toEqual({
      inline_keyboard: [
        [{ text: "Open Redlance", url: "https://redlance.app/feed" }],
      ],
    });
  });

  it("rejects an empty list and more than five", () => {
    expect(() => telegramAlert([], origin, now)).toThrow();
    expect(() =>
      telegramAlert(
        Array.from({ length: 6 }, () => item()),
        origin,
        now,
      ),
    ).toThrow();
  });
});

describe("telegramAlert without a usable app origin", () => {
  const hosts = [
    "http://localhost:3001",
    "http://app.localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ];

  it.each(hosts)("single match keeps only Open post for %s", (o) => {
    const m = telegramAlert([item()], o, now);
    expect(m.replyMarkup.inline_keyboard).toEqual([
      [
        {
          text: "🔗 Open post",
          url: "https://www.reddit.com/r/forhire/comments/abc/next/",
        },
      ],
    ]);
  });

  it.each(hosts)("list has plain titles and no buttons for %s", (o) => {
    const m = telegramAlert([item(), item({ matchId: "m2" })], o, now);
    expect(m.text).not.toContain("<a ");
    expect(m.text).toContain("Next.js dev to fix Stripe checkout");
    expect(m.replyMarkup.inline_keyboard).toEqual([]);
  });

  it("a single match with a non-Reddit url has no buttons", () => {
    const m = telegramAlert([item({ url: "https://x.com/a" })], hosts[0]!, now);
    expect(m.replyMarkup.inline_keyboard).toEqual([]);
  });

  it("a real domain still gets the app buttons", () => {
    expect(
      telegramAlert([item()], "https://redlance.app", now).replyMarkup
        .inline_keyboard[0],
    ).toHaveLength(2);
  });
});

describe("title truncation", () => {
  it("cuts by code points and never leaves half an emoji", () => {
    const title = "a".repeat(118) + "😀😀😀";
    const m = telegramAlert([item({ title })], origin, now);
    const first = m.text.split("\n")[0]!;
    expect(first).toContain("a".repeat(118) + "😀…");
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(m.text)).toBe(false);
    expect(/(?<![\ud800-\udbff])[\udc00-\udfff]/.test(m.text)).toBe(false);
  });
});

describe("alertLinks", () => {
  it("builds the draft link and keeps only Reddit post links", () => {
    expect(
      alertLinks(origin + "/", "m1", "https://www.reddit.com/r/a/"),
    ).toEqual({
      draft: "https://redlance.app/feed/m1",
      post: "https://www.reddit.com/r/a/",
    });
    expect(alertLinks(origin, "m1", "https://old.reddit.com/r/a/").post).toBe(
      null,
    );
  });
});

describe("budgetLabel", () => {
  it("formats ranges, single values, symbols and units", () => {
    expect(
      budgetLabel({ min: 400, max: 600, currency: "USD", unit: "fixed" }),
    ).toBe("$400–600");
    expect(
      budgetLabel({ min: 30, max: 30, currency: "GBP", unit: "hour" }),
    ).toBe("£30/hr");
    expect(
      budgetLabel({ min: null, max: 1500, currency: "EUR", unit: null }),
    ).toBe("€1,500");
    expect(
      budgetLabel({ min: 2000, max: null, currency: "INR", unit: "month" }),
    ).toBe("₹2,000/month");
    expect(
      budgetLabel({ min: 12.5, max: 20, currency: "CAD", unit: "per_item" }),
    ).toBe("CAD 12.50–20 per item");
    expect(budgetLabel({ min: 50, max: 80, currency: null, unit: "day" })).toBe(
      "50–80/day",
    );
  });

  it("is null without amounts", () => {
    expect(
      budgetLabel({ min: null, max: null, currency: "USD", unit: "fixed" }),
    ).toBe(null);
  });
});
