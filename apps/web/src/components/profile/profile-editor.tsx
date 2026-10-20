"use client";

import {
  CATEGORIES,
  SKILL_BY_ID,
  checkGithubInput,
  type CategoryId,
} from "@redlance/core";
import { LoaderCircle, Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BasicsFields, LEVEL_TEXT } from "@/components/onboarding/basics-step";
import { useCountryOptions } from "@/components/onboarding/browser-intl";
import { Field } from "@/components/onboarding/field";
import { RatesFields } from "@/components/onboarding/rates-step";
import { formatMoney } from "@/components/onboarding/review-format";
import { SkillsFields } from "@/components/onboarding/skills-step";
import type { FieldsForm } from "@/components/onboarding/step-form-types";
import { WorkFields } from "@/components/onboarding/work-step";
import {
  PROFILE_SECTIONS,
  SECTION_TITLES,
  allowanceText,
  type EditAllowance,
  type ProfileSection,
  type ProfileSections,
} from "@/lib/profile-edit";
import {
  canStartEdit,
  exhausted,
  savedToast,
  type SaveFailure,
  type SaveResponse,
} from "./profile-state";
import { useProfileSection } from "./use-profile-section";

export type ProfileEditorInit = {
  version: number;
  timeZone: string;
  sections: ProfileSections;
  allowance: EditAllowance;
};

const RATE_TYPE_TEXT = {
  hourly: "Hourly",
  fixed: "Fixed price",
  either: "Hourly or fixed",
} as const;

export function ProfileEditor({ init }: { init: ProfileEditorInit }) {
  const [sections, setSections] = useState(init.sections);
  const [version, setVersion] = useState(init.version);
  const [allowance, setAllowance] = useState(init.allowance);
  const [open, setOpen] = useState<ReadonlySet<ProfileSection>>(new Set());
  const timeZone = sections.basics.timeZone ?? init.timeZone;
  const text = allowanceText(allowance, timeZone);

  const setSectionOpen = (section: ProfileSection, on: boolean) =>
    setOpen((o) => {
      const next = new Set(o);
      if (on) next.add(section);
      else next.delete(section);
      return next;
    });

  function saved<K extends ProfileSection>(section: K, res: SaveResponse<K>) {
    setSections((s) => ({ ...s, [section]: res.data }));
    setVersion(res.version);
    setAllowance(res.allowance);
    setSectionOpen(section, false);
    toast.success(savedToast(res));
  }

  function failed(failure: SaveFailure) {
    if (failure.kind === "limit")
      setAllowance((a) => exhausted(a, failure.nextFreeAt));
  }

  return (
    <>
      <div
        className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm tabular-nums"
        aria-live="polite"
      >
        <span
          className={
            allowance.remaining === 0
              ? "font-medium text-danger"
              : "text-foreground"
          }
        >
          {text.summary}
        </span>
        {text.next && <span className="text-stone">· {text.next}</span>}
      </div>
      <p className="mt-1 max-w-xl text-sm text-stone">
        Each save that changes something uses one of {allowance.limit} changes a
        week. Gigs already in your feed keep their scores; new posts are matched
        with the updated profile.
      </p>

      <div className="mt-6">
        {PROFILE_SECTIONS.map((section) => {
          const isOpen = open.has(section);
          return (
            <section
              key={section}
              aria-labelledby={`profile-${section}`}
              className="border-t border-border py-6"
            >
              <div className="flex items-center justify-between gap-3">
                <h2
                  id={`profile-${section}`}
                  className="text-base font-semibold text-foreground"
                >
                  {SECTION_TITLES[section]}
                </h2>
                {!isOpen && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canStartEdit(allowance)}
                    onClick={() => setSectionOpen(section, true)}
                    aria-label={`Edit ${SECTION_TITLES[section].toLowerCase()}`}
                  >
                    <Pencil aria-hidden="true" /> Edit
                  </Button>
                )}
              </div>
              <div className="mt-3">
                {isOpen ? (
                  <SectionEditor
                    section={section}
                    sections={sections}
                    version={version}
                    timeZone={timeZone}
                    onSaved={(res) => saved(section, res)}
                    onFailed={failed}
                    onCancel={() => setSectionOpen(section, false)}
                  />
                ) : (
                  <SectionSummary section={section} sections={sections} />
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function SectionEditor<K extends ProfileSection>({
  section,
  sections,
  version,
  timeZone,
  onSaved,
  onFailed,
  onCancel,
}: {
  section: K;
  sections: ProfileSections;
  version: number;
  timeZone: string;
  onSaved: (res: SaveResponse<K>) => void;
  onFailed: (failure: SaveFailure) => void;
  onCancel: () => void;
}) {
  const edit = useProfileSection({
    section,
    saved: sections[section],
    version,
    timeZone,
    onSaved,
    onFailed,
  });
  // K picks the fields below; TypeScript can't narrow the form's type from it.
  const form: unknown = edit.form;

  return (
    <div>
      {section === "basics" && (
        <BasicsFields form={form as FieldsForm<"basics">} />
      )}
      {section === "skills" && (
        <SkillsFields
          form={form as FieldsForm<"skills">}
          jobTypes={sections.basics.categories as CategoryId[]}
        />
      )}
      {section === "work" && (
        <WorkFields
          form={form as FieldsForm<"work">}
          emptyText="No projects or roles yet. Add one so replies can point to your work."
        />
      )}
      {section === "rates" && (
        <RatesFields form={form as FieldsForm<"rates">} />
      )}
      {section === "github" && (
        <GithubField form={form as FieldsForm<"import">} />
      )}

      <div aria-live="polite" className="mt-4 min-h-5 text-sm">
        {edit.failure?.kind === "invalid" && (
          <p role="alert" className="text-danger">
            Some fields need attention.
          </p>
        )}
        {(edit.failure?.kind === "error" || edit.failure?.kind === "limit") && (
          <p role="alert" className="text-danger">
            {edit.failure.message}
          </p>
        )}
        {edit.failure?.kind === "conflict" && (
          <p role="alert" className="text-danger">
            Your profile was changed in another tab.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => window.location.reload()}
            >
              Reload to get the latest version
            </button>
            .
          </p>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          onClick={() => void edit.save()}
          disabled={edit.pending || !edit.dirty}
        >
          {edit.pending && (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          )}
          Save
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={edit.pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The GitHub link: a username or a github.com profile link, stored as the bare username. */
function GithubField({ form }: { form: FieldsForm<"import"> }) {
  const [typed, setTyped] = useState(form.value.githubUsername ?? "");
  const [hint, setHint] = useState<string | null>(null);
  const error = hint ?? form.errorFor("githubUsername");
  return (
    <fieldset disabled={!!form.pending}>
      <Field
        id="githubUsername"
        label="GitHub"
        optional
        hint="Your username or profile link. Replies can link it."
        error={error}
      >
        <Input
          id="githubUsername"
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? "githubUsername-error" : "githubUsername-hint"
          }
          autoComplete="off"
          spellCheck={false}
          placeholder="octocat or github.com/octocat"
          value={typed}
          onChange={(e) => {
            const next = e.target.value;
            setTyped(next);
            const check = checkGithubInput(next);
            setHint(check.ok ? null : check.message);
            // An invalid entry is kept as typed so Save shows the schema's error too.
            form.update({
              githubUsername: check.ok ? check.username : next.trim(),
            });
          }}
          className="h-11 max-w-md text-base md:text-sm"
        />
      </Field>
    </fieldset>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-1.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

const skillName = (id: string) => SKILL_BY_ID.get(id)?.name ?? id;

function SectionSummary({
  section,
  sections,
}: {
  section: ProfileSection;
  sections: ProfileSections;
}) {
  const countries = useCountryOptions();
  switch (section) {
    case "basics": {
      const b = sections.basics;
      return (
        <dl>
          <Row label="Name">{b.displayName}</Row>
          <Row label="Headline">{b.headline || "None"}</Row>
          <Row label="Job types">
            {b.categories
              .map((id) => CATEGORIES.find((c) => c.id === id)?.name ?? id)
              .join(", ")}
          </Row>
          <Row label="Experience">
            {b.experienceLevel ? LEVEL_TEXT[b.experienceLevel][0] : "None"}
          </Row>
          <Row label="Country">
            {countries?.find((c) => c.code === b.country)?.name ?? b.country}
          </Row>
          <Row label="Time zone">{b.timeZone?.replaceAll("_", " ")}</Row>
        </dl>
      );
    }
    case "skills": {
      const s = sections.skills;
      const all = [
        ...s.skills.map((k) => ({ name: skillName(k.id), level: k.level })),
        ...s.customSkills.map((k) => ({ name: k.name, level: k.level })),
      ];
      const core = all.filter((k) => k.level === "core").map((k) => k.name);
      const other = all.filter((k) => k.level !== "core").map((k) => k.name);
      return (
        <dl>
          <Row label="Core">{core.join(", ") || "None"}</Row>
          <Row label="Other">{other.join(", ") || "None"}</Row>
        </dl>
      );
    }
    case "work": {
      const w = sections.work;
      return (
        <dl>
          <Row label="Projects">
            {w.projects.length
              ? w.projects
                  .map((p) => (p.hidden ? `${p.title} (hidden)` : p.title))
                  .join(", ")
              : "None"}
          </Row>
          <Row label="Experience">
            {w.experience.length
              ? w.experience
                  .map((r) => (r.hidden ? `${r.title} (hidden)` : r.title))
                  .join(", ")
              : "None"}
          </Row>
          <Row label="Employer names">
            {w.mentionEmployers ? "Mentioned in replies" : "Not mentioned"}
          </Row>
        </dl>
      );
    }
    case "rates": {
      const r = sections.rates;
      return (
        <dl>
          <Row label="Minimum budget">
            <span className="tabular-nums">
              {r.minRate === null || r.currency === null
                ? "None"
                : formatMoney(r.minRate, r.currency)}
            </span>
          </Row>
          <Row label="Rate type">
            {r.rateType ? RATE_TYPE_TEXT[r.rateType] : "None"}
          </Row>
          <Row label="Remote only">{r.remoteOnly ? "Yes" : "No"}</Row>
        </dl>
      );
    }
    case "github": {
      const name = sections.github.githubUsername;
      return (
        <dl>
          <Row label="Profile">
            {name ? (
              <a
                href={`https://github.com/${name}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                github.com/{name}
              </a>
            ) : (
              "Not added"
            )}
          </Row>
        </dl>
      );
    }
  }
}
