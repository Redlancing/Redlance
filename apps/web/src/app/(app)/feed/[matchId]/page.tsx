import { feedItem } from "@redlance/db";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MatchDetail } from "@/components/feed/match-detail";
import { getCurrentUser } from "@/server/current-user";
import { getDb } from "@/server/db";
import { creditsSummary } from "@/server/drafts";
import { toFeedItemDetailResponse } from "@/server/feed";

export const metadata: Metadata = { title: "Match" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const [item, credits] = await Promise.all([
    feedItem(getDb(), user.userId, matchId.toLowerCase()),
    creditsSummary(user),
  ]);
  if (!item) notFound();
  return (
    <MatchDetail
      item={toFeedItemDetailResponse(item)}
      credits={
        credits.plan
          ? { balance: credits.balance, repliesLeft: credits.repliesLeft }
          : null
      }
    />
  );
}
