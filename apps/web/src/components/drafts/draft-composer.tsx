"use client";

import {
  INSTRUCTION_MAX,
  REWRITE_OPTIONS,
  SENT_TEXT_MAX,
  type RewriteOption,
} from "@redlance/core";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Sparkles,
  ThumbsDown,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch, type ApiFail } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-errors";
import { usePoll } from "@/lib/use-poll";
import { cn } from "@/lib/utils";
import type { DraftView } from "@/server/drafts";
import {
  DRAFT_COST,
  REWRITE_LABELS,
  costLine,
  failedDraftMessage,
  firstTab,
  hasUnsentEdits,
  isWorking,
  latestDone,
  rewriteBlocked,
  rewriteCost,
  textFor,
  upsertVersion,
  type Edits,
  type ReplyKind,
} from "./composer-state";

export type Credits = { balance: number; repliesLeft: number };

type Problem = { message: string; settingsLink: boolean };

/** Errors that the user fixes in settings (plan, credits) get a link there. */
function problemFrom(r: ApiFail): Problem {
  return {
    message: errorMessage(r),
    settingsLink: [
      "PLAN_EXPIRED",
      "INSUFFICIENT_CREDITS",
      "DAILY_LIMIT",
    ].includes(r.code),
  };
}

// Edits and what was marked sent live for the browser session, outside the component: moving to
// another match (the composer remounts) and back keeps them.
const editsByMatch = new Map<string, Edits>();
const sentByMatch = new Map<string, Partial<Record<ReplyKind, boolean>>>();

const TABS: { kind: ReplyKind; label: string }[] = [
  { kind: "comment", label: "Comment" },
  { kind: "dm", label: "DM" },
];

/**
 * The reply composer on a match page: draft (7 credits), poll until written, edit freely,
 * rewrite into new versions, copy, open the post, and mark what was sent. Nothing is ever
 * posted from here (rule 1): the user sends on Reddit.
 */
export function DraftComposer({
  matchId,
  postUrl,
  withdrawn,
  initialCredits,
  initialSent,
  onSent,
}: {
  matchId: string;
  postUrl: string;
  withdrawn: boolean;
  initialCredits: Credits | null;
  /** Kinds the server already has as sent (survives a reload). */
  initialSent: ReplyKind[];
  onSent: () => void;
}) {
  const [versions, setVersions] = useState<DraftView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [tab, setTab] = useState<ReplyKind>("comment");
  const [edits, setEdits] = useState<Edits>(
    () => editsByMatch.get(matchId) ?? {},
  );
  const [sent, setSent] = useState<Partial<Record<ReplyKind, boolean>>>(() => ({
    ...Object.fromEntries(initialSent.map((k) => [k, true])),
    ...sentByMatch.get(matchId),
  }));
  useEffect(() => {
    editsByMatch.set(matchId, edits);
    sentByMatch.set(matchId, sent);
  }, [matchId, edits, sent]);
  const [credits, setCredits] = useState(initialCredits);
  const [custom, setCustom] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  // Reused only when the same request is retried after a network failure, so a retry is never
  // charged twice and a different request never replays an earlier one.
  const keyRef = useRef<{ request: string; key: string } | null>(null);
  const keyFor = (request: string) => {
    if (keyRef.current?.request !== request)
      keyRef.current = { request, key: crypto.randomUUID() };
    return keyRef.current.key;
  };

  const current = versions.find((v) => v.id === currentId) ?? null;

  const show = useCallback((d: DraftView) => {
    setCurrentId(d.id);
    setTab(firstTab(d));
  }, []);

  // Versions already written for this match.
  useEffect(() => {
    let live = true;
    void apiFetch<{ versions: DraftView[] }>(
      `/api/v1/drafts?matchId=${matchId}`,
    ).then((r) => {
      if (!live) return;
      setLoaded(true);
      if (!r.ok) return setProblem(problemFrom(r));
      setVersions(r.data.versions);
      const done = latestDone(r.data.versions);
      if (done) show(done);
      const working = r.data.versions.find(isWorking);
      if (working) setPendingId(working.id);
    });
    return () => {
      live = false;
    };
  }, [matchId, show]);

  const refreshCredits = useCallback(async () => {
    const r = await apiFetch<Credits>("/api/v1/credits");
    if (r.ok) setCredits(r.data);
  }, []);

  const settle = useCallback(
    (d: DraftView) => {
      setVersions((v) => upsertVersion(v, d));
      if (d.status === "done") {
        show(d);
        setPendingId(null);
        setSlow(false);
        void refreshCredits();
      } else if (d.status === "failed") {
        setPendingId(null);
        setSlow(false);
        setProblem({
          message: failedDraftMessage(d.error),
          settingsLink: false,
        });
        void refreshCredits();
      }
    },
    [show, refreshCredits],
  );

  /** Stops waiting for a version, removing its placeholder from the list. */
  const dropPending = () => {
    setVersions((v) => v.filter((d) => d.id !== pendingId || !isWorking(d)));
    setPendingId(null);
    setSlow(false);
  };

  // Drafts take 2–4 s: poll fast for 30 s, then slowly up to the server's 10-minute expiry.
  const poll = () => apiFetch<DraftView>(`/api/v1/drafts/${pendingId}`);
  const pollDone = (r: Awaited<ReturnType<typeof poll>>) =>
    r.ok ? !isWorking(r.data) : r.status === 404;
  const onPoll = (r: Awaited<ReturnType<typeof poll>>) => {
    if (r.ok) settle(r.data);
    else if (r.status === 404) dropPending();
  };
  usePoll({
    enabled: pendingId !== null && !slow,
    firstDelayMs: 1500,
    intervalMs: 1000,
    timeoutMs: 30_000,
    fn: poll,
    isDone: pollDone,
    onResult: onPoll,
    onTimeout: () => setSlow(true),
  });
  usePoll({
    enabled: pendingId !== null && slow,
    intervalMs: 5000,
    timeoutMs: 10 * 60_000,
    fn: poll,
    isDone: pollDone,
    onResult: onPoll,
    onTimeout: () => {
      dropPending();
      setProblem({
        message: failedDraftMessage("EXPIRED"),
        settingsLink: false,
      });
    },
  });

  // Closing the tab with edits that weren't marked as sent asks first (moving between matches
  // keeps them, see editsByMatch).
  const unsent = hasUnsentEdits(versions, edits, sent);
  useEffect(() => {
    if (!unsent) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent]);

  async function startDraft() {
    setBusy(true);
    setProblem(null);
    const idempotencyKey = keyFor(`draft:${matchId}`);
    const r = await apiFetch<{ draftId: string; slowDown: boolean }>(
      "/api/v1/drafts",
      { method: "POST", json: { matchId, idempotencyKey } },
    );
    setBusy(false);
    if (!r.ok) {
      if (r.status !== 0) keyRef.current = null;
      return setProblem(problemFrom(r));
    }
    keyRef.current = null;
    if (r.data.slowDown)
      toast("That's a lot of drafts this hour. Take your time with each one.");
    setPendingId(r.data.draftId);
  }

  async function rewrite(
    choice: { option: RewriteOption } | { instruction: string },
  ) {
    if (!current) return;
    setBusy(true);
    setProblem(null);
    const idempotencyKey = keyFor(
      `rewrite:${current.id}:${JSON.stringify(choice)}`,
    );
    const r = await apiFetch<{ draftId: string; version: number }>(
      `/api/v1/drafts/${current.id}/rewrite`,
      { method: "POST", json: { ...choice, idempotencyKey } },
    );
    setBusy(false);
    if (!r.ok) {
      if (r.status !== 0) keyRef.current = null;
      return setProblem(problemFrom(r));
    }
    keyRef.current = null;
    setCustom(null);
    // A placeholder until the poll brings the real row, so the version list shows it.
    setVersions((v) =>
      upsertVersion(v, {
        ...current,
        id: r.data.draftId,
        version: r.data.version,
        status: "pending",
        kind: "rewrite",
        option: "option" in choice ? choice.option : "custom",
        instruction: "instruction" in choice ? choice.instruction : null,
        comment: null,
        dm: null,
        warning: false,
        problems: [],
        error: null,
      }),
    );
    setPendingId(r.data.draftId);
  }

  async function copy() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(textFor(current, edits, tab));
      toast.success("Copied. Paste it on Reddit.");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it yourself.");
    }
  }

  async function markSent() {
    if (!current) return;
    const sentText = textFor(current, edits, tab).trim();
    if (!sentText) return;
    setBusy(true);
    const r = await apiFetch(`/api/v1/replies`, {
      method: "POST",
      json: { draftId: current.id, kind: tab, sentText },
    });
    setBusy(false);
    if (!r.ok) return toast.error(errorMessage(r));
    setSent((s) => ({ ...s, [tab]: true }));
    toast.success(
      "Tracked. Update the outcome in the tracker when they reply.",
    );
    onSent();
  }

  async function sendFeedback() {
    if (!current || feedback === null) return;
    const r = await apiFetch(`/api/v1/drafts/${current.id}/feedback`, {
      method: "POST",
      json: feedback.trim() ? { reason: feedback.trim() } : {},
    });
    if (!r.ok) return toast.error(errorMessage(r));
    setFeedback(null);
    toast.success("Thanks. Future drafts will learn from this.");
  }

  const blocked = rewriteBlocked(versions);
  const writing = pendingId !== null;

  return (
    <section
      aria-labelledby="reply-heading"
      className="border-t border-border pt-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="reply-heading"
          className="text-base font-semibold text-foreground"
        >
          Your reply
        </h2>
        {versions.length > 1 && (
          <div role="group" aria-label="Versions" className="flex gap-1">
            {versions.map((v) => (
              <button
                key={v.id}
                type="button"
                disabled={v.status !== "done"}
                aria-pressed={v.id === currentId}
                onClick={() => show(v)}
                title={v.option ? REWRITE_LABELS[v.option] : "First draft"}
                className={cn(
                  "h-6 min-w-6 rounded-md px-1.5 text-xs font-medium tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50",
                  v.id === currentId
                    ? "bg-ink text-bone"
                    : "text-stone hover:bg-muted hover:text-foreground",
                )}
              >
                v{v.version}
              </button>
            ))}
          </div>
        )}
      </div>

      <div aria-live="polite" className="sr-only">
        {writing ? "Writing your reply." : current ? "Reply ready." : ""}
      </div>

      {problem && (
        <div
          role="alert"
          className="mt-4 rounded-[10px] border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {problem.message}
          {problem.settingsLink && (
            <>
              {" "}
              <Link
                href="/settings"
                className="font-medium underline underline-offset-2"
              >
                See your plan
              </Link>
            </>
          )}
        </div>
      )}

      {!loaded && (
        <div className="mt-4 h-40 animate-pulse rounded-[10px] bg-muted" />
      )}

      {loaded && !current && !writing && (
        <div className="mt-4">
          {withdrawn ? (
            <p className="text-sm text-stone">
              This post no longer fits your profile, so it can&apos;t be
              drafted.
            </p>
          ) : (
            <>
              <Button
                size="lg"
                onClick={() => void startDraft()}
                disabled={busy}
              >
                <Sparkles aria-hidden="true" />
                {busy ? "Starting…" : "Draft reply"}
              </Button>
              <p className="mt-2 text-xs text-stone tabular-nums">
                {costLine(DRAFT_COST, credits)} · a comment and a first DM, in
                your style
              </p>
            </>
          )}
        </div>
      )}

      {writing && (
        <p className="mt-4 flex items-center gap-2 text-sm text-stone">
          <span
            className="size-2 animate-pulse rounded-full bg-flare-500 motion-reduce:animate-none"
            aria-hidden="true"
          />
          {slow
            ? "Taking longer than usual. You can leave; it'll be here when you're back."
            : current
              ? "Writing a new version…"
              : "Writing your reply…"}
        </p>
      )}

      {current && (
        <div className="mt-4">
          {current.warning && (
            <p className="mb-3 flex items-start gap-2 rounded-[10px] bg-flare-50 px-3 py-2 text-sm text-flare-700">
              <TriangleAlert
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              Check this one carefully before sending: it didn&apos;t pass all
              our checks.
            </p>
          )}
          <div
            role="tablist"
            aria-label="Reply type"
            className="flex gap-4 border-b border-border"
          >
            {TABS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                role="tab"
                id={`tab-${kind}`}
                aria-selected={tab === kind}
                aria-controls={`panel-${kind}`}
                onClick={() => setTab(kind)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 pb-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                  tab === kind
                    ? "border-ink text-foreground"
                    : "border-transparent text-stone hover:text-foreground",
                )}
              >
                {label}
                {sent[kind] && (
                  <Check className="size-3.5 text-success" aria-label="sent" />
                )}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`panel-${tab}`}
            aria-labelledby={`tab-${tab}`}
          >
            {tab === "comment" && !current.comment ? (
              <p className="py-4 text-sm text-stone">
                This post asks for a DM, so there&apos;s no comment. Use the DM
                tab.
              </p>
            ) : (
              <textarea
                aria-label={tab === "comment" ? "Comment text" : "DM text"}
                value={textFor(current, edits, tab)}
                onChange={(e) =>
                  setEdits((all) => ({
                    ...all,
                    [current.id]: { ...all[current.id], [tab]: e.target.value },
                  }))
                }
                rows={tab === "comment" ? 6 : 8}
                maxLength={SENT_TEXT_MAX}
                className="mt-3 block w-full resize-y rounded-[10px] border border-input bg-background px-3 py-2.5 text-[15px] leading-relaxed text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void copy()}>
              <Copy aria-hidden="true" />
              Copy
            </Button>
            <a
              href={postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline" })}
            >
              <ExternalLink aria-hidden="true" />
              Open post
            </a>
            <Button
              onClick={() => void markSent()}
              disabled={
                busy || sent[tab] || !textFor(current, edits, tab).trim()
              }
            >
              <Check aria-hidden="true" />
              {sent[tab]
                ? "Marked as sent"
                : tab === "comment"
                  ? "I posted this comment"
                  : "I sent this DM"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-stone">
            Copy it, post it on Reddit yourself, then mark it here so the
            tracker can follow up.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={blocked !== null || busy}
                render={<Button variant="ghost" size="sm" />}
              >
                Rewrite
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {REWRITE_OPTIONS.map((o) => (
                  <DropdownMenuItem
                    key={o}
                    onClick={() =>
                      o === "custom"
                        ? setCustom("")
                        : void rewrite({ option: o })
                    }
                  >
                    <span className="flex-1">{REWRITE_LABELS[o]}</span>
                    <span className="ml-6 text-xs text-muted-foreground tabular-nums">
                      {rewriteCost(o)}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={feedback !== null}
              onClick={() => setFeedback(feedback === null ? "" : null)}
            >
              <ThumbsDown aria-hidden="true" />
              Not good
            </Button>
            {blocked && <span className="text-xs text-stone">{blocked}</span>}
          </div>

          {custom !== null && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (custom.trim()) void rewrite({ instruction: custom.trim() });
              }}
            >
              <input
                autoFocus
                aria-label="How should it change?"
                placeholder="e.g. mention I can start Monday"
                maxLength={INSTRUCTION_MAX}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <Button
                type="submit"
                size="default"
                disabled={!custom.trim() || busy}
              >
                Rewrite · 1 credit
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCustom(null)}
              >
                Cancel
              </Button>
            </form>
          )}

          {feedback !== null && (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void sendFeedback();
              }}
            >
              <textarea
                aria-label="What was wrong with this draft?"
                placeholder="What was wrong? (optional)"
                maxLength={300}
                rows={2}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                className="block w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <Button type="submit" size="sm" variant="outline">
                Send feedback
              </Button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
