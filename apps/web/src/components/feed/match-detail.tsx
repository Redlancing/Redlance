"use client";

import {
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  PenLine,
  Undo2,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import {
  DraftComposer,
  type Credits,
} from "@/components/drafts/draft-composer";
import { Button, buttonVariants } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import type { DraftView } from "@/server/drafts";
import type { FeedItemDetailResponse } from "@/server/feed";
import {
  announceMatchStatus,
  knownStatus,
  onMatchStatus,
  setOpenMatch,
} from "./feed-events";
import { undoStatus, type MatchStatus } from "./feed-state";
import { BackToMatches, MatchHeader, MatchNotes } from "./match-header";
import { openView, serverOpenView, serverView } from "./match-status";

/** The page's view never changes after mount; useSyncExternalStore only picks server vs client. */
const subscribeNothing = () => () => {};

export function MatchDetail({
  item,
  credits,
  sentKinds,
  initialVersions,
  loadedAt,
}: {
  item: FeedItemDetailResponse;
  credits: Credits | null;
  /** Reply kinds already marked as sent for this post. */
  sentKinds: ("comment" | "dm")[];
  /** Draft versions the server loaded with the page; the composer fetches them if absent. */
  initialVersions?: DraftView[];
  /**
   * When the server loaded this page's data (epoch ms). Older than `STALE_AFTER_MS` (a page
   * served from Next's client cache) means the status, drafts and sent state are shown at once
   * and checked again in the background.
   */
  loadedAt?: number;
}) {
  const searchParams = useSearchParams();
  const backHref = `/feed${searchParams.size ? `?${searchParams.toString()}` : ""}`;
  // What to show first and whether to check the server (match-status.ts), decided once per
  // mount. The server render and hydration use the server's view (never stale): the browser's
  // view reads its clock and this tab's statuses, so it is only used after hydration (or at once
  // on a client-side navigation), which keeps the server HTML and the first client render equal.
  const [views] = useState(() => ({
    server: serverOpenView(item.status),
    client:
      typeof window === "undefined"
        ? null
        : openView({
            pageStatus: item.status,
            loadedAt,
            local: knownStatus(item.matchId),
            now: Date.now(),
          }),
  }));
  const view = useSyncExternalStore(
    subscribeNothing,
    () => views.client ?? views.server,
    () => views.server,
  );
  const stale = view.stale;
  // A status set on this page (or learned from the server) since it opened, over `view.status`.
  const [changed, setChanged] = useState<MatchStatus | null>(null);
  const status = changed ?? view.status;
  const [withdrawn, setWithdrawn] = useState(item.withdrawn);
  // Set once the user or the list changed the status here, so a late server answer can't undo it.
  const touched = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const post = item.post;

  // The latest status, for rollbacks, undo and server answers that arrive after later changes.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  });
  const show = useCallback((s: MatchStatus) => {
    statusRef.current = s;
    setChanged(s);
  }, []);

  // A server answer (background check or the conditional "seen"): shown unless changed here
  // since, and announced when it differs, so the list row and this tab's memory follow.
  const sync = useCallback(
    (server: MatchStatus | null) => {
      const next = serverView({
        shown: statusRef.current,
        server,
        touched: touched.current,
      });
      if (next.status !== statusRef.current) show(next.status);
      if (next.announce)
        announceMatchStatus({ matchId: item.matchId, status: next.status });
    },
    [item.matchId, show],
  );

  useEffect(() => setOpenMatch(item.matchId), [item.matchId]);

  // Opening a new match marks it seen (also when it was opened from an alert link). The server
  // only does it while the match is still "new", so old data can't overwrite a Save, Dismiss or
  // Replied made since; its answer is the real status.
  const seenSent = useRef(false);
  useEffect(() => {
    if (!view.markSeen || seenSent.current) return;
    seenSent.current = true;
    void apiFetch<{ status: MatchStatus }>(
      `/api/v1/feed/${item.matchId}/status`,
      { method: "POST", json: { status: "seen", onlyIfNew: true } },
    ).then((r) => {
      if (r.ok) sync(r.data.status);
    });
  }, [item.matchId, view.markSeen, sync]);

  // Old data: shown at once, checked once in the background (status, withdrawn).
  useEffect(() => {
    if (!stale) return;
    let live = true;
    void apiFetch<FeedItemDetailResponse>(`/api/v1/feed/${item.matchId}`).then(
      (r) => {
        if (!live) return;
        if (!r.ok) return sync(null);
        setWithdrawn(r.data.withdrawn);
        sync(r.data.status);
      },
    );
    return () => {
      live = false;
    };
  }, [item.matchId, stale, sync]);

  // Changes made from the list (keyboard shortcuts) show here too. This page's own
  // announcements already match what it shows.
  useEffect(
    () =>
      onMatchStatus(({ matchId, status: s }) => {
        if (matchId === item.matchId && s !== statusRef.current) {
          touched.current = true;
          show(s);
        }
      }),
    [item.matchId, show],
  );

  async function change(next: MatchStatus, undoable = false) {
    const before = statusRef.current;
    if (before === next) return;
    touched.current = true;
    show(next);
    const r = await apiFetch(`/api/v1/feed/${item.matchId}/status`, {
      method: "POST",
      json: { status: next },
    });
    if (!r.ok) {
      // Roll back only if nothing changed it since.
      if (statusRef.current === next) show(before);
      return toast.error(errorMessage(r));
    }
    // The whole match goes along, so a list that dropped it on dismiss can put it back.
    announceMatchStatus({ matchId: item.matchId, status: next, item });
    if (undoable)
      toast("Dismissed", {
        action: {
          label: "Undo",
          onClick: () => void change(undoStatus(before)),
        },
      });
  }

  const saved = status === "saved";
  const dismissed = status === "dismissed";

  return (
    <article className="mx-auto max-w-3xl px-4 pt-4 pb-10 sm:px-8 md:pt-8">
      <BackToMatches href={backHref} />

      {(dismissed || withdrawn) && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[10px] bg-muted px-4 py-2.5 text-sm text-stone">
          <span>
            {withdrawn
              ? "This post no longer fits your profile (it was re-checked after it changed)."
              : "You dismissed this gig."}
          </span>
          {dismissed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void change("seen")}
            >
              <Undo2 aria-hidden="true" />
              Restore
            </Button>
          )}
        </div>
      )}

      <MatchHeader item={item} />

      <div className="mt-4 flex flex-wrap gap-2">
        {!withdrawn && (
          <a href="#reply" className={buttonVariants()}>
            <PenLine aria-hidden="true" />
            Reply
          </a>
        )}
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline" })}
        >
          <ExternalLink aria-hidden="true" />
          Open post
        </a>
        <Button
          variant="outline"
          aria-pressed={saved}
          onClick={() => void change(saved ? "seen" : "saved")}
          disabled={dismissed}
        >
          {saved ? (
            <BookmarkCheck aria-hidden="true" />
          ) : (
            <Bookmark aria-hidden="true" />
          )}
          {saved ? "Saved" : "Save"}
        </Button>
        {!dismissed && (
          <Button
            variant="ghost"
            onClick={() => void change("dismissed", true)}
          >
            <X aria-hidden="true" />
            Dismiss
          </Button>
        )}
      </div>

      <MatchNotes item={item} />

      <section aria-labelledby="post-heading" className="mt-6">
        <h2 id="post-heading" className="text-sm font-semibold text-foreground">
          The post
        </h2>
        {post.summary && (
          <p className="mt-1 text-sm text-stone">
            <span className="font-medium text-foreground">In short:</span>{" "}
            {post.summary}
          </p>
        )}
        {post.body && (
          <>
            <div
              className={cn(
                "mt-3 text-[15px] leading-relaxed whitespace-pre-wrap text-foreground",
                !expanded && "line-clamp-[12]",
              )}
            >
              {post.body}
            </div>
            {post.body.split("\n").length > 10 || post.body.length > 900 ? (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                aria-expanded={expanded}
                className="mt-1 text-sm font-medium text-stone hover:text-foreground"
              >
                {expanded ? "Show less" : "Show the whole post"}
              </button>
            ) : null}
          </>
        )}
      </section>

      <div id="reply" className="mt-8 scroll-mt-6">
        <DraftComposer
          key={item.matchId}
          matchId={item.matchId}
          postUrl={post.url}
          withdrawn={withdrawn}
          initialCredits={credits}
          initialSent={sentKinds}
          initialVersions={initialVersions}
          revalidate={stale}
          onSent={() => {
            touched.current = true;
            show("replied");
            announceMatchStatus({ matchId: item.matchId, status: "replied" });
          }}
        />
      </div>
    </article>
  );
}
