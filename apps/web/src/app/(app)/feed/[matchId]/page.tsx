import { feedItem } from "@redlance/db";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { MatchDetail } from "@/components/feed/match-detail";
import { getCurrentUser } from "@/server/current-user";
import { getDb } from "@/server/db";
import { creditsSummary } from "@/server/drafts";
import { toFeedItemDetailResponse } from "@/server/feed";
import { sentKindsForPost } from "@/server/replies";

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
  const [item, credits] = await Promise.all([
    loadMatch(user.userId, matchId),
    creditsSummary(user),
  ]);
  if (!item) notFound();
  const sentKinds = await sentKindsForPost(user, item.post.id);
  return (
    <MatchDetail
      item={toFeedItemDetailResponse(item)}
      sentKinds={sentKinds}
      credits={
        credits.plan
          ? { balance: credits.balance, repliesLeft: credits.repliesLeft }
          : null
      }
    />
  );
}
