"use client";

import { CURRENCIES, LIMITS, RATE_TYPES } from "@redlance/core";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { selectClass } from "./basics-step";
import { Field, FieldGroup, controlProps, errorId, hintId } from "./field";
import { parseRateText, rateTextToShow } from "./rate-text";
import { RestoreBanner, StepActions } from "./step-actions";
import { StepHeader } from "./step-header";
import { TagInput } from "./tag-input";
import { useStepForm, type StepFormInit } from "./use-step-form";

const RATE_TEXT: Record<(typeof RATE_TYPES)[number], string> = {
  hourly: "Hourly",
  fixed: "Fixed price",
  either: "Either",
};

export function RatesStep({ init }: { init: StepFormInit<"rates"> }) {
  const form = useStepForm(init);
  const v = form.value;
  const wordsId = useId();
  // The box keeps its own text so "12." can be typed; the form holds the number.
  const [typed, setTyped] = useState(
    v.minRate === null ? "" : String(v.minRate),
  );
  // Show the typed text only while it still means the form's number (a restore or discard changes it).
  const rateText = rateTextToShow(typed, v.minRate);
  const rateError = form.errorFor("minRate") ?? form.errorFor("currency");

  return (
    <>
      <StepHeader
        title="Rates & filters"
        description="Redlance skips posts that don't fit. You can change these any time."
      />
      <RestoreBanner form={form} />
      <fieldset disabled={!!form.pending} className="space-y-6">
        <Field
          id="minRate"
          label="Minimum budget"
          hint="0 means any budget. Posts that state a lower budget are skipped."
          error={rateError}
        >
          <div className="flex gap-2">
            <Input
              {...controlProps("minRate", rateError, "hint")}
              aria-label="Minimum budget"
              inputMode="decimal"
              value={rateText}
              onChange={(e) => {
                const text = e.target.value;
                if (!/^\d*\.?\d*$/.test(text)) return; // digits and one dot only
                setTyped(text);
                form.update({ minRate: parseRateText(text) });
              }}
              className="h-11 flex-1 text-base md:text-sm"
            />
            <select
              aria-label="Currency"
              aria-invalid={form.errorFor("currency") ? true : undefined}
              aria-describedby={
                rateError ? errorId("minRate") : hintId("minRate")
              }
              value={v.currency ?? ""}
              onChange={(e) =>
                form.update({
                  currency: (e.target.value || null) as typeof v.currency,
                })
              }
              className={`${selectClass} w-28`}
            >
              {!v.currency && <option value="">Choose…</option>}
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </Field>

        <FieldGroup
          legend="Rate type"
          error={form.errorFor("rateType")}
          errorKey="rateType"
        >
          <div className="grid gap-2 sm:grid-cols-3">
            {RATE_TYPES.map((type) => (
              <label
                key={type}
                className="flex cursor-pointer flex-col rounded-xl border border-border px-3.5 py-3 has-checked:border-ink has-checked:bg-bone has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              >
                <input
                  type="radio"
                  name="rateType"
                  value={type}
                  checked={v.rateType === type}
                  onChange={() => form.update({ rateType: type })}
                  className="sr-only"
                />
                <span className="text-sm font-medium">{RATE_TEXT[type]}</span>
              </label>
            ))}
          </div>
        </FieldGroup>

        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={v.remoteOnly}
            onChange={(e) => form.update({ remoteOnly: e.target.checked })}
            className="size-4 accent-ink"
          />
          Only show remote gigs
        </label>

        <Field
          id={wordsId}
          label="Blocked words"
          optional
          hint={`Posts containing these are skipped, e.g. "unpaid", "exposure", "equity only". Up to ${LIMITS.blockedWords}.`}
          error={form.errorFor("blockedWords")}
        >
          <TagInput
            id={wordsId}
            values={v.blockedWords}
            onChange={(blockedWords) => form.update({ blockedWords })}
            max={LIMITS.blockedWords}
            maxLength={LIMITS.blockedWord}
            placeholder="Type a word and press Enter"
            invalid={!!form.errorFor("blockedWords")}
            describedBy={
              form.errorFor("blockedWords") ? errorId(wordsId) : hintId(wordsId)
            }
          />
        </Field>
      </fieldset>
      <StepActions form={form} back="skills" nextLabel="Review" />
    </>
  );
}
