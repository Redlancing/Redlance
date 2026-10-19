import type { FeedCursor, FeedItem } from "@redlance/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** base64url of `<ISO date>|<uuid>`. */
export function encodeCursor(c: FeedCursor): string {
  return Buffer.from(`${c.postedAt.toISOString()}|${c.id}`, "utf8").toString(
    "base64url",
  );
}

/** Null for anything that isn't a cursor we made. */
export function decodeCursor(s: string): FeedCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length > 200) return null;
  const parts = Buffer.from(s, "base64url").toString("utf8").split("|");
  if (parts.length !== 2) return null;
  const [iso, id] = parts as [string, string];
  if (!ISO.test(iso) || !UUID.test(id)) return null;
  const postedAt = new Date(iso);
  if (Number.isNaN(postedAt.getTime())) return null;
  return { postedAt, id: id.toLowerCase() };
}

export type FeedItemResponse = Omit<FeedItem, "post"> & {
  post: Omit<FeedItem["post"], "postedAt"> & { postedAt: string };
};

export type FeedResponse = {
  items: FeedItemResponse[];
  nextCursor: string | null;
};

/** Maps db items to the public shape: explicit fields only, dates as ISO strings. */
export function toFeedResponse(page: {
  items: FeedItem[];
  next: FeedCursor | null;
}): FeedResponse {
  return {
    items: page.items.map((i) => ({
      matchId: i.matchId,
      score: i.score,
      reason: i.reason,
      broad: i.broad,
      status: i.status,
      aiStatus: i.aiStatus,
      bestProject: i.bestProject
        ? { id: i.bestProject.id, title: i.bestProject.title }
        : null,
      bestRole: i.bestRole
        ? { id: i.bestRole.id, title: i.bestRole.title }
        : null,
      post: {
        id: i.post.id,
        title: i.post.title,
        community: i.post.community,
        url: i.post.url,
        postedAt: i.post.postedAt.toISOString(),
        summary: i.post.summary,
        categories: i.post.categories,
        budget: i.post.budget
          ? {
              min: i.post.budget.min,
              max: i.post.budget.max,
              currency: i.post.budget.currency,
              unit: i.post.budget.unit,
            }
          : null,
        payType: i.post.payType,
        remote: i.post.remote,
        deadline: i.post.deadline,
        redFlags: i.post.redFlags,
        alsoPostedIn: i.post.alsoPostedIn,
      },
    })),
    nextCursor: page.next ? encodeCursor(page.next) : null,
  };
}
