"use client";

import {
  CATEGORIES,
  LIMITS,
  SKILL_BY_ID,
  findSkill,
  searchSkills,
  skillsForCategories,
  type CategoryId,
} from "@redlance/core";
import { cn } from "cn";
import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { FieldGroup, controlProps } from "./field";
import { enterAction } from "./skill-search";
import { nextSkillLevel, type SkillLevel } from "./skill-levels";
import { RestoreBanner, StepActions } from "./step-actions";
import { StepHeader } from "./step-header";
import type { FieldsForm } from "./step-form-types";
import { useStepForm, type StepFormInit } from "./use-step-form";

type Chip = { index: number; name: string; level: SkillLevel };

const categoryName = (id: CategoryId) =>
  CATEGORIES.find((c) => c.id === id)?.name ?? "";

export function SkillsStep({
  init,
  jobTypes,
}: {
  init: StepFormInit<"skills">;
  jobTypes: CategoryId[];
}) {
  const form = useStepForm(init);
  return (
    <>
      <StepHeader
        title="Your skills"
        description={`Mark the ones you'd most like to be hired for as core (up to ${LIMITS.coreSkills}).`}
      />
      <RestoreBanner form={form} />
      <SkillsFields form={form} jobTypes={jobTypes} />
      <StepActions form={form} back="basics" />
    </>
  );
}

/** The Skills fields, shared by onboarding and the profile page. */
export function SkillsFields({
  form,
  jobTypes,
}: {
  form: FieldsForm<"skills">;
  /** Ranks search results and picks the "Popular" suggestions. */
  jobTypes: CategoryId[];
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const v = form.value;
  const chosen = new Set(v.skills.map((s) => s.id));
  const total = v.skills.length;
  const coreCount = v.skills.filter((s) => s.level === "core").length;
  const nextLevel = () => nextSkillLevel(coreCount, LIMITS.coreSkills);
  const full = total >= LIMITS.totalSkills;

  const results = searchSkills(query, {
    categories: jobTypes,
    limit: 8,
  }).filter((s) => !chosen.has(s.id));
  const found = findSkill(query);
  const alreadyAdded = !!found && !found.retired && chosen.has(found.id);
  const popular = skillsForCategories(jobTypes, 16)
    .filter((s) => !chosen.has(s.id))
    .slice(0, 10);

  function addSkill(id: string) {
    if (full || chosen.has(id)) return;
    form.update({
      skills: [...v.skills, { id, level: nextLevel(), source: "manual" }],
    });
    setQuery("");
  }
  const setLevel = (index: number, level: SkillLevel) =>
    form.update({
      skills: v.skills.map((s, i) => (i === index ? { ...s, level } : s)),
    });
  const remove = (index: number) =>
    form.update({ skills: v.skills.filter((_, i) => i !== index) });

  const chips: Chip[] = v.skills.map((s, index) => ({
    index,
    name: SKILL_BY_ID.get(s.id)?.name ?? s.id,
    level: s.level,
  }));
  const skillsError = form.errorFor("skills");

  function renderChip(c: Chip) {
    const core = c.level === "core";
    return (
      <li
        key={c.index}
        className={cn(
          "flex items-center gap-1 rounded-full border py-1 pr-1 pl-3 text-sm",
          core ? "border-ink bg-ink text-white" : "border-border bg-background",
        )}
      >
        <span>{c.name}</span>
        <button
          type="button"
          aria-label={
            core
              ? `Make ${c.name} an other skill`
              : `Make ${c.name} a core skill`
          }
          onClick={() => setLevel(c.index, core ? "secondary" : "core")}
          className={cn(
            "rounded-full px-2 py-0.5 text-xs underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
            core ? "text-white/80" : "text-muted-foreground",
          )}
        >
          {core ? "Make other" : "Make core"}
        </button>
        <button
          type="button"
          aria-label={`Remove ${c.name}`}
          onClick={() => remove(c.index)}
          className={cn(
            "rounded-full p-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            core
              ? "text-white/80 hover:text-white"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </li>
    );
  }

  const coreChips = chips.filter((c) => c.level === "core");
  const otherChips = chips.filter((c) => c.level !== "core");

  return (
    <fieldset disabled={!!form.pending} className="space-y-6">
      <div className="space-y-2">
        <label htmlFor={searchId} className="text-sm font-medium">
          Add skills
        </label>
        <Input
          {...controlProps(searchId)}
          aria-describedby={full ? `${searchId}-hint` : undefined}
          value={query}
          disabled={full}
          placeholder="Search skills, tools or software"
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const action = enterAction(query, { results, chosen });
            if (action.type === "skill") addSkill(action.id);
          }}
          className="h-11 text-base md:text-sm"
        />
        {full && (
          <p id={`${searchId}-hint`} className="text-xs text-muted-foreground">
            That&apos;s the maximum
          </p>
        )}
        {!full && query.trim() && (
          <ul className="space-y-1">
            {results.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => addSkill(s.id)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm outline-none hover:bg-bone focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  <span>{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {categoryName(s.category)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!full && query.trim() && results.length === 0 && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {alreadyAdded
              ? "Already added."
              : "No matching skill. Try another name."}
          </p>
        )}
      </div>

      {!full && !query.trim() && popular.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Popular for your job types</p>
          <ul className="flex flex-wrap gap-2">
            {popular.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => addSkill(s.id)}
                  className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-sm outline-none hover:border-foreground/25 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <FieldGroup
        legend={`Core skills (${coreCount}/${LIMITS.coreSkills})`}
        error={skillsError}
        errorKey="skills"
      >
        {coreChips.length > 0 ? (
          <ul className="flex flex-wrap gap-2">{coreChips.map(renderChip)}</ul>
        ) : (
          <p className="text-sm text-muted-foreground">None yet.</p>
        )}
      </FieldGroup>

      <FieldGroup legend="Other skills" errorKey="otherSkills">
        {otherChips.length > 0 ? (
          <ul className="flex flex-wrap gap-2">{otherChips.map(renderChip)}</ul>
        ) : (
          <p className="text-sm text-muted-foreground">None yet.</p>
        )}
      </FieldGroup>

      <p className="text-xs text-muted-foreground">
        {total}/{LIMITS.totalSkills} skills
      </p>
    </fieldset>
  );
}
