import { TELEGRAM_MATCHES_PER_MESSAGE } from "./constants";

/** One match as the alert shows it. Post text is untrusted and escaped here. */
export interface AlertItem {
  matchId: string;
  score: number;
  title: string;
  community: string;
  url: string;
  postedAt: Date;
  budgetText: string | null;
  reason: string;
}

export interface TelegramButton {
  text: string;
  url: string;
}
export interface TelegramMessage {
  /** For `parse_mode: "HTML"`. */
  text: string;
  replyMarkup: { inline_keyboard: TelegramButton[][] };
}

const MAX_TITLE = 120;

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Only https://www.reddit.com/… links; anything else is dropped. */
function redditUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "www.reddit.com"
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

/** The two links an alert can carry; `post` is null for a non-Reddit URL. */
export function alertLinks(
  appOrigin: string,
  matchId: string,
  postUrl: string,
): { draft: string; post: string | null } {
  return {
    draft: `${appOrigin.replace(/\/+$/, "")}/feed/${encodeURIComponent(matchId)}`,
    post: redditUrl(postUrl),
  };
}

function cleanTitle(title: string): string {
  const t = title.replace(/^\s*\[hiring\]\s*[:\-–—]?\s*/i, "").trim();
  return t.length > MAX_TITLE ? t.slice(0, MAX_TITLE - 1) + "…" : t;
}

function age(postedAt: Date, now: Date): string {
  const min = Math.max(
    0,
    Math.floor((now.getTime() - postedAt.getTime()) / 60_000),
  );
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
  return `${Math.floor(min / (24 * 60))} d ago`;
}

function metaLine(item: AlertItem, now: Date): string {
  const parts = [
    `r/${escapeHtml(item.community)}`,
    `posted ${age(item.postedAt, now)}`,
  ];
  if (item.budgetText) parts.push(escapeHtml(item.budgetText));
  return parts.join(" · ");
}

/** The `tg@1` alert: one match in full, or 2–5 matches as a list. */
export function telegramAlert(
  items: AlertItem[],
  appOrigin: string,
  now: Date,
): TelegramMessage {
  if (items.length === 0 || items.length > TELEGRAM_MATCHES_PER_MESSAGE) {
    throw new Error(
      `telegramAlert takes 1-${TELEGRAM_MATCHES_PER_MESSAGE} items`,
    );
  }
  if (items.length === 1) {
    const item = items[0]!;
    const links = alertLinks(appOrigin, item.matchId, item.url);
    const buttons: TelegramButton[] = [
      { text: "✍️ Draft reply", url: links.draft },
    ];
    if (links.post) buttons.push({ text: "🔗 Open post", url: links.post });
    return {
      text: [
        `🎯 <b>${item.score}</b> · <b>${escapeHtml(cleanTitle(item.title))}</b>`,
        metaLine(item, now),
        escapeHtml(item.reason),
      ].join("\n"),
      replyMarkup: { inline_keyboard: [buttons] },
    };
  }
  const blocks = items.map((item) => {
    const { draft } = alertLinks(appOrigin, item.matchId, item.url);
    return [
      `<b>${item.score}</b> · <a href="${escapeHtml(draft)}">${escapeHtml(cleanTitle(item.title))}</a>`,
      metaLine(item, now),
      escapeHtml(item.reason),
    ].join("\n");
  });
  return {
    text: [`🎯 <b>${items.length} new matches</b>`, ...blocks].join("\n\n"),
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: "Open Redlance",
            url: `${appOrigin.replace(/\/+$/, "")}/feed`,
          },
        ],
      ],
    },
  };
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  INR: "₹",
};
const UNIT_SUFFIX: Record<string, string> = {
  hour: "/hr",
  day: "/day",
  week: "/week",
  month: "/month",
  per_item: " per item",
};

function amount(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString("en-US")
    : n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}

/** A posted budget as an alert shows it ("$400–600", "£30/hr"); null when there is none. */
export function budgetLabel(b: {
  min: number | null;
  max: number | null;
  currency: string | null;
  unit: string | null;
}): string | null {
  if (b.min === null && b.max === null) return null;
  const range =
    b.min !== null && b.max !== null && b.min !== b.max
      ? `${amount(b.min)}–${amount(b.max)}`
      : amount((b.max ?? b.min)!);
  const symbol = b.currency
    ? (CURRENCY_SYMBOLS[b.currency] ?? `${b.currency} `)
    : "";
  return `${symbol}${range}${(b.unit && UNIT_SUFFIX[b.unit]) ?? ""}`;
}
