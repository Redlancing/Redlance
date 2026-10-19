"use client";

import {
  DOMAINS,
  SKILL_BY_ID,
  WORK_LIMITS,
  searchSkills,
  type DomainId,
  type MonthYear,
} from "@redlance/core";
import { cn } from "cn";
import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldGroup, controlProps, errorId } from "./field";
import { MONTH_NAMES, linkError, removeAt, setLine } from "./work-cards";

// Small controls shared by the project and role editors in work-step.tsx.

const chipButton =
  "outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** Up to `max` text lines (outcomes, highlights) or links, each in its own box. */
export function LineList({
  id,
  legend,
  addLabel,
  lines,
  max,
  onChange,
  errorFor,
  placeholder,
  checkLinks = false,
  hint,
}: {
  id: string;
  legend: string;
  addLabel: string;
  lines: readonly string[];
  max: number;
  onChange: (lines: string[]) => void;
  /** The form's error for the whole list (index undefined) or one line. */
  errorFor: (index?: number) => string | undefined;
  placeholder?: string;
  /** Check each line with checkLink once the box has been left. */
  checkLinks?: boolean;
  hint?: string;
}) {
  const [touched, setTouched] = useState<ReadonlySet<number>>(new Set());
  const listError = errorFor();
  // Only an error about the list as a whole goes on the group; line errors sit by their box.
  const lineErrors = lines.map((l, i) => {
    const own = errorFor(i);
    if (own) return own;
    return checkLinks && touched.has(i)
      ? (linkError(l) ?? undefined)
      : undefined;
  });
  const groupError = lineErrors.some(Boolean) ? undefined : listError;

  return (
    <FieldGroup legend={legend} hint={hint} error={groupError} errorKey={id}>
      {lines.length > 0 && (
        <ul className="space-y-2">
          {lines.map((line, i) => {
            const inputId = `${id}-${i}`;
            return (
              <li key={i}>
                <div className="flex gap-2">
                  <Input
                    {...controlProps(inputId, lineErrors[i])}
                    aria-label={`${legend} ${i + 1}`}
                    value={line}
                    placeholder={placeholder}
                    autoComplete="off"
                    inputMode={checkLinks ? "url" : undefined}
                    onChange={(e) =>
                      onChange(setLine(lines, i, e.target.value))
                    }
                    onBlur={() => setTouched((t) => new Set(t).add(i))}
                    className="h-11 min-w-0 flex-1 text-base md:text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    aria-label={`Remove ${legend.toLowerCase()} ${i + 1}`}
                    onClick={() => {
                      setTouched(new Set());
                      onChange(removeAt(lines, i));
                    }}
                    className="size-11"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
                {lineErrors[i] && (
                  <p id={errorId(inputId)} className="mt-1 text-sm text-danger">
                    {lineErrors[i]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {lines.length < max && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...lines, ""])}
        >
          <Plus aria-hidden="true" /> {addLabel}
        </Button>
      )}
    </FieldGroup>
  );
}

/** A month (optional) and a year. The month waits for a year. */
export function DateFields({
  id,
  legend,
  value,
  onChange,
  error,
}: {
  id: string;
  legend: string;
  value: MonthYear | null;
  onChange: (value: MonthYear | null) => void;
  error?: string;
}) {
  return (
    <FieldGroup legend={legend} error={error} errorKey={id}>
      <div className="flex gap-2">
        <select
          aria-label={`${legend} month`}
          disabled={!value}
          value={value?.month ?? ""}
          onChange={(e) =>
            value &&
            onChange({
              ...value,
              month: e.target.value ? Number(e.target.value) : null,
            })
          }
          className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm"
        >
          <option value="">Month</option>
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
        <Input
          aria-label={`${legend} year`}
          inputMode="numeric"
          placeholder="Year"
          autoComplete="off"
          value={value ? String(value.year) : ""}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
            onChange(
              digits
                ? { year: Number(digits), month: value?.month ?? null }
                : null,
            );
          }}
          className="h-11 w-28 shrink-0 text-base md:text-sm"
        />
      </div>
    </FieldGroup>
  );
}

/** Search the skill list and pick up to ten. Only skills from our list (no custom ones here). */
export function SkillPicker({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: readonly string[];
  onChange: (ids: string[]) => void;
  error?: string;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const full = value.length >= WORK_LIMITS.entrySkills;
  const results = searchSkills(query, { limit: 6 }).filter(
    (s) => !value.includes(s.id),
  );
  const add = (skillId: string) => {
    if (full || value.includes(skillId)) return;
    onChange([...value, skillId]);
    setQuery("");
  };

  return (
    <FieldGroup
      legend={`Skills (${value.length}/${WORK_LIMITS.entrySkills})`}
      error={error}
      errorKey={id}
    >
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((skillId) => {
            const name = SKILL_BY_ID.get(skillId)?.name ?? skillId;
            return (
              <li
                key={skillId}
                className="flex items-center gap-1 rounded-full border border-border bg-background py-1 pr-1 pl-3 text-sm"
              >
                {name}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => onChange(value.filter((s) => s !== skillId))}
                  className={cn(
                    "rounded-full p-1 text-muted-foreground hover:text-foreground",
                    chipButton,
                  )}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Input
        id={searchId}
        aria-label="Search skills"
        value={query}
        disabled={full}
        placeholder={full ? "That's the maximum" : "Search skills or tools"}
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (results[0]) add(results[0].id);
        }}
        className="h-11 text-base md:text-sm"
      />
      {!full && query.trim() && (
        <ul className="space-y-1">
          {results.length === 0 && (
            <li className="text-sm text-muted-foreground">
              No match. Skills here come from our list.
            </li>
          )}
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => add(s.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-bone",
                  chipButton,
                )}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </FieldGroup>
  );
}

/** Pick up to four domains from the fixed list. */
export function DomainChips({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: readonly DomainId[];
  onChange: (ids: DomainId[]) => void;
  error?: string;
}) {
  const full = value.length >= WORK_LIMITS.domains;
  return (
    <FieldGroup
      legend={`Domains (${value.length}/${WORK_LIMITS.domains})`}
      hint="The kind of business the work was for."
      error={error}
      errorKey={id}
    >
      <ul className="flex flex-wrap gap-2">
        {DOMAINS.map((d) => {
          const on = value.includes(d.id);
          return (
            <li key={d.id}>
              <button
                type="button"
                aria-pressed={on}
                disabled={full && !on}
                onClick={() =>
                  onChange(
                    on ? value.filter((x) => x !== d.id) : [...value, d.id],
                  )
                }
                className={cn(
                  "rounded-full border px-3 py-1 text-sm disabled:opacity-40",
                  on
                    ? "border-ink bg-ink text-white"
                    : "border-border bg-background hover:border-foreground/25",
                  chipButton,
                )}
              >
                {d.label}
              </button>
            </li>
          );
        })}
      </ul>
    </FieldGroup>
  );
}
