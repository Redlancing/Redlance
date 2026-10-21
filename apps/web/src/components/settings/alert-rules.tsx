"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-errors";
import {
  ALERT_MAX_SCORE,
  ALERT_MIN_SCORE,
  ALERT_SCORE_STEP,
  clampDailyCap,
  scoreBandLabel,
  snapScore,
} from "./telegram-state";

type Saved = { minScore: number; dailyCap: number };
const DEBOUNCE_MS = 600;

export function AlertRules({
  minScore,
  dailyCap,
  onSaved,
}: Saved & { onSaved: (next: Saved) => void }) {
  const [score, setScore] = useState(snapScore(minScore));
  const [cap, setCap] = useState(String(dailyCap));
  const saved = useRef<Saved>({ minScore, dailyCap });
  const pending = useRef<Partial<Saved>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  function queue(patch: Partial<Saved>) {
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
  }

  async function flush() {
    const patch = pending.current;
    pending.current = {};
    timer.current = null;
    // Skip values that match what the server already has.
    const body: Partial<Saved> = {};
    if (
      patch.minScore !== undefined &&
      patch.minScore !== saved.current.minScore
    )
      body.minScore = patch.minScore;
    if (
      patch.dailyCap !== undefined &&
      patch.dailyCap !== saved.current.dailyCap
    )
      body.dailyCap = patch.dailyCap;
    if (Object.keys(body).length === 0) return;
    const mine = ++seq.current;
    const res = await apiFetch<Saved>("/api/v1/alerts/settings", {
      method: "PATCH",
      json: body,
    });
    if (mine !== seq.current && res.ok) {
      // A newer save is in flight; only the newest updates saved.current.
      return;
    }
    if (res.ok) {
      saved.current = {
        minScore: res.data.minScore,
        dailyCap: res.data.dailyCap,
      };
      onSaved(saved.current);
      toast.success("Saved");
    } else if (mine === seq.current) {
      setScore(snapScore(saved.current.minScore));
      setCap(String(saved.current.dailyCap));
      toast.error(errorMessage(res));
    }
  }

  const flushRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(
    () => () => {
      // Leaving the page: send any change still waiting out the debounce.
      if (timer.current) {
        clearTimeout(timer.current);
        void flushRef.current();
      }
    },
    [],
  );

  return (
    <section
      aria-labelledby="rules-heading"
      className="border-t border-border py-6"
    >
      <h2
        id="rules-heading"
        className="text-base font-semibold text-foreground"
      >
        Alert rules
      </h2>

      <div className="mt-4 max-w-md">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="min-score">Minimum score</Label>
          <span className="text-sm font-medium text-foreground tabular-nums">
            {score}
          </span>
        </div>
        <input
          id="min-score"
          type="range"
          min={ALERT_MIN_SCORE}
          max={ALERT_MAX_SCORE}
          step={ALERT_SCORE_STEP}
          value={score}
          aria-valuetext={`${score}, ${scoreBandLabel(score)}`}
          onChange={(e) => {
            const v = snapScore(Number(e.target.value));
            setScore(v);
            queue({ minScore: v });
          }}
          className="mt-2 h-2 w-full cursor-pointer accent-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        />
        <p
          className={
            "mt-2 text-sm " +
            (score >= 85
              ? "text-flare-700"
              : score >= 70
                ? "text-foreground"
                : "text-muted-foreground")
          }
        >
          {scoreBandLabel(score)}. You&apos;re alerted for matches scoring{" "}
          <span className="tabular-nums">{score}</span> or more.
        </p>
        {minScore < ALERT_MIN_SCORE && (
          <p className="mt-1 text-sm text-muted-foreground">
            Currently {minScore}; moving the slider will save a new value.
          </p>
        )}
      </div>

      <div className="mt-6 max-w-md">
        <Label htmlFor="daily-cap">Alerts per day</Label>
        <Input
          id="daily-cap"
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          value={cap}
          onChange={(e) => {
            setCap(e.target.value);
            if (e.target.value === "") return;
            const v = clampDailyCap(Number(e.target.value));
            queue({ dailyCap: v });
          }}
          onBlur={() => {
            const v = clampDailyCap(Number(cap || saved.current.dailyCap));
            setCap(String(v));
          }}
          className="mt-2 w-24 tabular-nums"
        />
        <p className="mt-2 text-sm text-muted-foreground">
          The most alerts we send you in a day, from 1 to 100.
        </p>
      </div>
    </section>
  );
}
