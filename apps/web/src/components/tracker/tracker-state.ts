export const REPLY_STATUSES = [
  "sent",
  "replied",
  "hired",
  "lost",
  "no_reply",
  "ghosted",
] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

/** Statuses the user can choose; "sent" is the starting state only. */
export const SETTABLE_STATUSES = [
  "replied",
  "hired",
  "lost",
  "no_reply",
  "ghosted",
] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

export const STATUS_LABELS: Record<ReplyStatus, string> = {
  sent: "Sent",
  replied: "Replied",
  hired: "Hired",
  lost: "Lost",
  no_reply: "No reply",
  ghosted: "Ghosted",
};

export type StatusFilter = "all" | ReplyStatus;

export const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...REPLY_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
];

/** The `?status=` value to a filter; anything unknown is "all". */
export function parseFilter(
  value: string | string[] | undefined,
): StatusFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return (REPLY_STATUSES as readonly string[]).includes(v ?? "")
    ? (v as ReplyStatus)
    : "all";
}

export function filterHref(filter: StatusFilter): string {
  return filter === "all" ? "/tracker" : `/tracker?status=${filter}`;
}

export type ReplyItem = {
  id: string;
  draftId: string | null;
  matchId: string | null;
  kind: "comment" | "dm";
  sentText: string;
  editRatio: number | null;
  sentAt: string;
  status: ReplyStatus;
  updatedAt: string;
  post: { id: string; title: string; community: string; url: string };
};

export type ListState = {
  items: ReplyItem[];
  nextCursor: string | null;
};

export const EMPTY_LIST: ListState = { items: [], nextCursor: null };

export function setPage(
  items: ReplyItem[],
  nextCursor: string | null,
): ListState {
  return { items, nextCursor };
}

/** Adds the next page, skipping rows already shown (a status change can shift paging). */
export function appendPage(
  state: ListState,
  items: ReplyItem[],
  nextCursor: string | null,
): ListState {
  const seen = new Set(state.items.map((i) => i.id));
  return {
    items: [...state.items, ...items.filter((i) => !seen.has(i.id))],
    nextCursor,
  };
}

/** Replaces fields of one row; other rows keep their identity. */
export function patchItem(
  state: ListState,
  id: string,
  patch: Partial<Pick<ReplyItem, "status" | "updatedAt">>,
): ListState {
  return {
    ...state,
    items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
  };
}

export const MAX_RATE_MINOR = 100_000_000;

/** "1,250.50" to 125050; null when it isn't a plain amount of at most 2 decimals. */
export function majorToMinor(input: string): number | null {
  const clean = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

export type PatchBody = {
  status: SettableStatus;
  agreedRateMinor?: number;
  currency?: string;
  unpaid?: boolean;
};

export type HiredInput = { rate: string; currency: string; unpaid: boolean };

/**
 * The PATCH body for a status change. Only "hired" carries a rate, and the rate and currency go
 * together or not at all. "Unpaid" wins over a typed rate.
 */
export function buildPatchBody(
  status: SettableStatus,
  hired?: HiredInput,
): { ok: true; body: PatchBody } | { ok: false; error: string } {
  if (status !== "hired" || !hired) return { ok: true, body: { status } };
  if (hired.unpaid) return { ok: true, body: { status, unpaid: true } };
  if (hired.rate.trim() === "") return { ok: true, body: { status } };
  const minor = majorToMinor(hired.rate);
  if (minor === null) {
    return {
      ok: false,
      error: "Enter the rate as a number, like 450 or 450.50.",
    };
  }
  if (minor > MAX_RATE_MINOR) {
    return { ok: false, error: "That rate is too large." };
  }
  const currency = hired.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "Use a 3-letter currency code, like USD." };
  }
  return { ok: true, body: { status, agreedRateMinor: minor, currency } };
}
