"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-errors";
import { AlertRules } from "./alert-rules";
import type { TelegramSettings } from "./telegram-state";
import { TelegramSection } from "./telegram-section";

export type AlertSettings = {
  minScore: number;
  dailyCap: number;
  telegram: TelegramSettings;
};

/** Loads `/alerts/settings` once and renders the Telegram and alert-rules sections from it. */
export function AlertSettingsPanel() {
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiFetch<AlertSettings>("/api/v1/alerts/settings");
    if (res.ok) setSettings(res.data);
    else setError(errorMessage(res));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error && !settings) {
    return (
      <div className="border-t border-border py-6" role="alert">
        <p className="text-sm text-danger">{error}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => void load()}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!settings) {
    return (
      <div aria-hidden="true" className="space-y-px">
        <div className="border-t border-border py-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-3 h-8 w-64" />
        </div>
        <div className="border-t border-border py-6">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-3 h-16 w-full max-w-md" />
        </div>
      </div>
    );
  }

  return (
    <>
      <TelegramSection
        telegram={settings.telegram}
        onTelegram={(telegram) =>
          setSettings((s) => (s ? { ...s, telegram } : s))
        }
      />
      <AlertRules
        minScore={settings.minScore}
        dailyCap={settings.dailyCap}
        onSaved={(next) => setSettings((s) => (s ? { ...s, ...next } : s))}
      />
    </>
  );
}
