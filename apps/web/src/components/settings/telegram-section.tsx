"use client";

import { Send } from "lucide-react";
import { useReducer, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-errors";
import { usePoll } from "@/lib/use-poll";
import {
  deriveView,
  disabledReasonCopy,
  initialLocal,
  reduce,
  type TelegramSettings,
} from "./telegram-state";

type SettingsResponse = { telegram: TelegramSettings };

export function TelegramSection({
  telegram,
  onTelegram,
}: {
  telegram: TelegramSettings;
  onTelegram: (next: TelegramSettings) => void;
}) {
  const [local, dispatch] = useReducer(reduce, initialLocal);
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const view = deriveView(telegram, local);

  usePoll<SettingsResponse | null>({
    enabled: local.phase === "waiting",
    intervalMs: 2000,
    timeoutMs: local.waitMs,
    fn: async () => {
      const res = await apiFetch<SettingsResponse>("/api/v1/alerts/settings");
      return res.ok ? res.data : null;
    },
    isDone: (v) => !!v && v.telegram.linked && v.telegram.enabled,
    onResult: (v) => {
      if (!v) return;
      onTelegram(v.telegram);
      dispatch({ type: "settings", settings: v.telegram });
    },
    onTimeout: () => dispatch({ type: "expire" }),
  });

  async function connect() {
    dispatch({ type: "start" });
    const res = await apiFetch<{ url: string; expiresAt: string }>(
      "/api/v1/alerts/telegram/link",
      { method: "POST" },
    );
    if (!res.ok) {
      dispatch({
        type: "linkFailed",
        code: res.code,
        message: errorMessage(res),
      });
      return;
    }
    // Opened here, a moment after the click; if the browser blocks it we show the link instead.
    const opened = window.open(res.data.url, "_blank", "noopener,noreferrer");
    dispatch({
      type: "linkCreated",
      now: Date.now(),
      expiresAt: new Date(res.data.expiresAt).getTime(),
      fallbackUrl: opened ? null : res.data.url,
    });
  }

  async function disconnect() {
    setDisconnecting(true);
    const res = await apiFetch<{ ok: true }>("/api/v1/alerts/telegram", {
      method: "DELETE",
    });
    setDisconnecting(false);
    if (!res.ok) {
      toast.error(errorMessage(res));
      return;
    }
    setConfirming(false);
    dispatch({ type: "disconnected" });
    onTelegram({ linked: true, enabled: false, disabledReason: "user_stop" });
  }

  const connectButton = (label: string) => (
    <Button onClick={() => void connect()}>
      <Send aria-hidden="true" />
      {label}
    </Button>
  );

  let body: React.ReactNode;
  switch (view.kind) {
    case "loading":
      body = <Skeleton className="h-8 w-48" />;
      break;
    case "notLinked":
      body = (
        <>
          <p className="text-sm text-muted-foreground">
            Get a message in Telegram when a strong gig is posted.
          </p>
          <div className="mt-4">{connectButton("Connect Telegram")}</div>
        </>
      );
      break;
    case "linking":
      body = (
        <Button disabled aria-busy="true">
          <Send aria-hidden="true" />
          Connecting…
        </Button>
      );
      break;
    case "waiting":
      body = (
        <>
          <p className="text-sm text-foreground">
            Press Start in Telegram. Waiting…
          </p>
          {view.fallbackUrl && (
            <a
              href={view.fallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex h-8 items-center rounded-lg border border-input px-2.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Open Telegram
            </a>
          )}
        </>
      );
      break;
    case "connected":
      body = (
        <>
          <p className="text-sm text-foreground">Connected.</p>
          <div className="mt-4">
            <Button variant="outline" onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          </div>
        </>
      );
      break;
    case "off":
      body = (
        <>
          <p className="text-sm text-muted-foreground">
            {disabledReasonCopy(view.reason)}
          </p>
          <div className="mt-4">{connectButton("Connect again")}</div>
        </>
      );
      break;
    case "expired":
      body = (
        <>
          <p className="text-sm text-muted-foreground">
            That link expired. Try again.
          </p>
          <div className="mt-4">{connectButton("Connect Telegram")}</div>
        </>
      );
      break;
    case "unavailable":
      body = (
        <p className="text-sm text-muted-foreground">
          Telegram alerts aren&apos;t available right now.
        </p>
      );
      break;
    case "error":
      body = (
        <>
          <p className="text-sm text-danger">{view.message}</p>
          <div className="mt-4">{connectButton("Try again")}</div>
        </>
      );
      break;
  }

  return (
    <section
      aria-labelledby="telegram-heading"
      className="border-t border-border py-6"
    >
      <h2
        id="telegram-heading"
        className="text-base font-semibold text-foreground"
      >
        Telegram alerts
      </h2>
      <div className="mt-3" role="status" aria-live="polite">
        {body}
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Telegram?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll stop getting gig alerts. You can connect again any
              time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={disconnecting}
              onClick={() => void disconnect()}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
