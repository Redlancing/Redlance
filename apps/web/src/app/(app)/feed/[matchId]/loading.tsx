import { MatchPreview } from "@/components/feed/match-preview";

// Shown in the feed layout's match pane while a match page loads (and as the page's first paint
// on a phone). A prefetched match skips it: the page comes from Next's client cache.
export default function MatchLoading() {
  return <MatchPreview />;
}
