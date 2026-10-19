"use client";

import { CATEGORIES, EXPERIENCE_LEVELS, LIMITS } from "@redlance/core";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import {
  useBrowserTimeZone,
  useBrowserTimeZones,
  useCountryOptions,
} from "./browser-intl";
import { Field, FieldGroup, controlProps } from "./field";
import { RestoreBanner, StepActions } from "./step-actions";
import { StepHeader } from "./step-header";
import { useStepForm, type StepFormInit } from "./use-step-form";

export const LEVEL_TEXT: Record<
  (typeof EXPERIENCE_LEVELS)[number],
  [string, string]
> = {
  beginner: ["Getting started", "A few projects or none paid yet"],
  intermediate: ["Some paid work", "Regular clients or a year or two in"],
  experienced: ["Experienced", "Several years of client work"],
};

export const selectClass =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

export function BasicsStep({ init }: { init: StepFormInit<"basics"> }) {
  const browserZone = useBrowserTimeZone();
  const zones = useBrowserTimeZones();
  const countries = useCountryOptions();
  const form = useStepForm(init, {
    // The browser's zone is the default until the user picks one.
    prepare: (v) => ({ ...v, timeZone: v.timeZone ?? browserZone }),
  });
  const v = form.value;
  const zone = v.timeZone ?? browserZone ?? "";
  // Keep the current zone selectable even when the browser's list lacks it (e.g. "UTC").
  const zoneOptions = zones
    ? zone && !zones.includes(zone)
      ? [zone, ...zones]
      : zones
    : zone
      ? [zone]
      : [];
  const country = v.country ?? "";

  function toggleCategory(id: (typeof CATEGORIES)[number]["id"]) {
    const has = v.categories.includes(id);
    form.update({
      categories: has
        ? v.categories.filter((c) => c !== id)
        : [...v.categories, id],
    });
  }

  return (
    <>
      <StepHeader
        title="The basics"
        description="What clients see first, and what kind of work you want."
      />
      <RestoreBanner form={form} />
      <fieldset disabled={!!form.pending} className="space-y-6">
        <Field
          id="displayName"
          label="Your name"
          hint="As you'd sign a message to a client."
          error={form.errorFor("displayName")}
        >
          <Input
            {...controlProps("displayName", form.errorFor("displayName"))}
            autoComplete="name"
            maxLength={LIMITS.displayName}
            value={v.displayName}
            onChange={(e) => form.update({ displayName: e.target.value })}
            className="h-11 text-base md:text-sm"
          />
        </Field>

        <Field
          id="headline"
          label="Headline"
          optional
          hint={`${v.headline.length}/${LIMITS.headline} · e.g. "Video editor for YouTube creators"`}
          error={form.errorFor("headline")}
        >
          <Input
            {...controlProps("headline", form.errorFor("headline"), "hint")}
            maxLength={LIMITS.headline}
            value={v.headline}
            onChange={(e) => form.update({ headline: e.target.value })}
            className="h-11 text-base md:text-sm"
          />
        </Field>

        <FieldGroup
          legend="What kind of work do you want?"
          hint="Pick up to 3. This decides which jobs we show you."
          error={form.errorFor("categories")}
          errorKey="categories"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {CATEGORIES.map((c) => {
              const on = v.categories.includes(c.id);
              const full = !on && v.categories.length >= LIMITS.categories;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => toggleCategory(c.id)}
                  className={cn(
                    "rounded-xl border px-3.5 py-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                    on
                      ? "border-ink bg-ink text-white"
                      : "border-border bg-background hover:border-foreground/25",
                  )}
                >
                  <span className="block text-sm font-medium">{c.name}</span>
                  <span
                    className={cn(
                      "block text-xs",
                      on ? "text-white/70" : "text-muted-foreground",
                    )}
                  >
                    {c.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </FieldGroup>

        <FieldGroup
          legend="Experience"
          error={form.errorFor("experienceLevel")}
          errorKey="experienceLevel"
        >
          <div className="grid gap-2 sm:grid-cols-3">
            {EXPERIENCE_LEVELS.map((level) => (
              <label
                key={level}
                className="flex cursor-pointer flex-col rounded-xl border border-border px-3.5 py-3 has-checked:border-ink has-checked:bg-bone has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              >
                <input
                  type="radio"
                  name="experienceLevel"
                  value={level}
                  checked={v.experienceLevel === level}
                  onChange={() => form.update({ experienceLevel: level })}
                  className="sr-only"
                />
                <span className="text-sm font-medium">
                  {LEVEL_TEXT[level][0]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {LEVEL_TEXT[level][1]}
                </span>
              </label>
            ))}
          </div>
        </FieldGroup>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field id="country" label="Country" error={form.errorFor("country")}>
            <select
              {...controlProps("country", form.errorFor("country"))}
              autoComplete="country"
              value={v.country ?? ""}
              onChange={(e) => form.update({ country: e.target.value || null })}
              className={selectClass}
            >
              <option value="">Choose…</option>
              {(
                countries ?? (country ? [{ code: country, name: country }] : [])
              ).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="timeZone"
            label="Time zone"
            hint="Used for alert timing and posting-hour insights."
            error={form.errorFor("timeZone")}
          >
            <select
              {...controlProps("timeZone", form.errorFor("timeZone"), "hint")}
              value={zone}
              onChange={(e) => form.update({ timeZone: e.target.value })}
              className={selectClass}
            >
              {!zone && <option value="">Choose…</option>}
              {zoneOptions.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>
      <StepActions form={form} back="import" />
    </>
  );
}
