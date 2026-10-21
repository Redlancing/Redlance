import { feedItem } from "@redlance/db";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { MatchDetail } from "@/components/feed/match-detail";
import { stampNow } from "@/lib/freshness";
import { getCurrentUser } from "@/server/current-user";
import { getDb } from "@/server/db";
import { creditsSummary, listVersions } from "@/server/drafts";
import { toFeedItemDetailResponse } from "@/server/feed";
import { matchInsightLine } from "@/server/insights";
import { sentKindsForMatch } from "@/server/replies";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One read per request, shared by the title and the page.
const loadMatch = cache(async (userId: string, matchId: string) =>
  UUID.test(matchId) ? feedItem(getDb(), userId, matchId.toLowerCase()) : null,
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchId: string }>;
}): Promise<Metadata> {
  const { matchId } = await params;
  const user = await getCurrentUser();
  const item = user ? await loadMatch(user.userId, matchId) : null;
  // Absolute: the feed layout's own title would otherwise drop the site suffix.
  return { title: { absolute: `${item?.post.title ?? "Match"} · Redlance` } };
}

// The match page; Telegram alert buttons link here.
export default async function MatchPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/feed/${encodeURIComponent(matchId)}`);
  if (!UUID.test(matchId)) notFound();
  const id = matchId.toLowerCase();
  // Taken before the reads, so it can only make the data look older than it is. The client
  // compares it to its own clock: a page kept in Next's client cache for minutes is checked
  // again in the background (see STALE_AFTER_MS).
  const loadedAt = stampNow();
  // Drafts and sent state are keyed by the match, so all five reads run together.
  // The insight line needs the post's subreddit, so it starts as soon as the match is loaded
  // and runs beside the other reads instead of after them.
  const itemRead = loadMatch(user.userId, id);
  const [item, credits, versions, sentKinds, insightLine] = await Promise.all([
    itemRead,
    creditsSummary(user),
    listVersions(user, id),
    sentKindsForMatch(user, id),
    itemRead.then((i) =>
      i ? matchInsightLine(user.userId, i.post.community) : null,
    ),
  ]);
  if (!item) notFound();
  return (
    <MatchDetail
      item={toFeedItemDetailResponse(item)}
      insightLine={insightLine}
      sentKinds={sentKinds}
      initialVersions={versions}
      loadedAt={loadedAt}
      credits={
        credits.plan
          ? { balance: credits.balance, repliesLeft: credits.repliesLeft }
          : null
      }
    />
  );
}
