"use client";

import { Loader2, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-errors";
import { HiredDialog } from "./hired-dialog";
import { TrackerRow } from "./tracker-row";
import {
  EMPTY_LIST,
  appendPage,
  buildPatchBody,
  patchItem,
  setPage,
  type ListState,
  type PatchBody,
  type ReplyItem,
  type ReplyStatus,
  type SettableStatus,
  type StatusFilter,
} from "./tracker-state";

type Page = { items: ReplyItem[]; nextCursor: string | null };
type View = "loading" | "ready" | "error";

const PAGE_SIZE = 20;

function pageUrl(filter: StatusFilter, cursor: string | null): string {
  const q = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (filter !== "all") q.set("status", filter);
  if (cursor) q.set("cursor", cursor);
  return `/api/v1/replies?${q}`;
}

/** Render with `key={filter}` so a filter change starts from the loading state. */
export function TrackerList({ filter }: { filter: StatusFilter }) {
  const [list, setList] = useState<ListState>(EMPTY_LIST);
  const [view, setView] = useState<View>("loading");
  const [error, setError] = useState("");
  const [moreBusy, setMoreBusy] = useState(false);
  const [hiredFor, setHiredFor] = useState<ReplyItem | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<Page>(pageUrl(filter, null));
    if (res.ok) {
      setList(setPage(res.data.items, res.data.nextCursor));
      setView("ready");
    } else {
      setError(errorMessage(res));
      setView("error");
    }
  }, [filter]);

  useEffect(() => {
    // Runs once per mount (the parent keys this component by filter).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function retry() {
    setView("loading");
    void load();
  }

  async function loadMore() {
    const cursor = list.nextCursor;
    if (!cursor || moreBusy) return;
    setMoreBusy(true);
    const res = await apiFetch<Page>(pageUrl(filter, cursor));
    setMoreBusy(false);
    if (res.ok) {
      setList((s) => appendPage(s, res.data.items, res.data.nextCursor));
    } else {
      toast.error(errorMessage(res));
    }
  }

  const latest = useRef(new Map<string, number>());

  async function update(item: ReplyItem, body: PatchBody) {
    const previous: ReplyStatus = item.status;
    const previousUpdatedAt = item.updatedAt;
    const mine = (latest.current.get(item.id) ?? 0) + 1;
    latest.current.set(item.id, mine);
    setList((s) => patchItem(s, item.id, { status: body.status }));
    const res = await apiFetch<{ status: ReplyStatus; updatedAt: string }>(
      `/api/v1/replies/${item.id}`,
      { method: "PATCH", json: body },
    );
    if (res.ok) {
      setList((s) =>
        patchItem(s, item.id, {
          status: res.data.status,
          updatedAt: res.data.updatedAt,
        }),
      );
    } else {
      // Only roll back if no newer change to this row has been made since.
      if (latest.current.get(item.id) === mine) {
        setList((s) =>
          patchItem(s, item.id, {
            status: previous,
            updatedAt: previousUpdatedAt,
          }),
        );
      }
      toast.error(errorMessage(res));
    }
  }

  function choose(item: ReplyItem, status: SettableStatus) {
    if (status === "hired") {
      setHiredFor(item);
      return;
    }
    const built = buildPatchBody(status);
    if (built.ok) void update(item, built.body);
  }

  if (view === "loading") {
    return (
      <ul aria-busy="true" aria-label="Loading replies" className="mt-2">
        {Array.from({ length: 6 }, (_, i) => (
          <li
            key={i}
            className="flex h-[65px] items-center gap-3 border-b border-border"
          >
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </li>
        ))}
      </ul>
    );
  }

  if (view === "error") {
    return (
      <div role="alert" className="mt-6 border-y border-border py-6">
        <p className="text-sm text-foreground">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={retry}>
          <RotateCw aria-hidden="true" />
          Retry
        </Button>
      </div>
    );
  }

  if (list.items.length === 0) {
    return (
      <p className="mt-6 max-w-md border-y border-border py-8 text-sm text-muted-foreground">
        {filter === "all"
          ? "Replies you mark as sent show up here, so you can track which ones turn into work."
          : "No replies with this status yet."}
      </p>
    );
  }

  return (
    <>
      <ul className="mt-2 border-t border-border">
        {list.items.map((item) => (
          <TrackerRow key={item.id} item={item} onChoose={choose} />
        ))}
      </ul>
      {list.nextCursor && (
        <div className="pt-4">
          <Button variant="outline" onClick={loadMore} disabled={moreBusy}>
            {moreBusy && (
              <Loader2 className="animate-spin" aria-hidden="true" />
            )}
            Load more
          </Button>
        </div>
      )}
      <HiredDialog
        open={hiredFor !== null}
        title={hiredFor?.post.title ?? ""}
        onClose={() => setHiredFor(null)}
        onConfirm={(body) => {
          const target = hiredFor;
          setHiredFor(null);
          if (target) void update(target, body);
        }}
      />
    </>
  );
}
