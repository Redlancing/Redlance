"use client";

import {
  DOMAINS,
  ORGANISATION_FREE_TYPES,
  PROJECT_KINDS,
  PROJECT_ROLES,
  ROLE_EMPLOYMENT_TYPES,
  SKILL_BY_ID,
  WORK_LIMITS,
  checkLink,
  type ProjectKind,
  type ProjectRole,
  type RoleEmploymentType,
} from "@redlance/core";
import { cn } from "cn";
import { Plus } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateFields, DomainChips, LineList, SkillPicker } from "./entry-fields";
import { Field, FieldGroup, controlProps } from "./field";
import { RestoreBanner, StepActions } from "./step-actions";
import { StepHeader } from "./step-header";
import { useStepForm, type StepFormInit } from "./use-step-form";
import {
  addProject,
  addRole,
  editEntry,
  fitKeys,
  formatDates,
  removeAt,
  setEmploymentType,
  toggleHidden,
  type ProjectCard,
  type RoleCard,
} from "./work-cards";

const ROLE_TEXT: Record<ProjectRole, string> = {
  solo: "Solo",
  lead: "Led the team",
  team: "Part of a team",
  unknown: "Not sure",
};
const KIND_TEXT: Record<ProjectKind, string> = {
  client: "Client work",
  employer: "For an employer",
  personal: "Personal",
  open_source: "Open source",
  academic: "Academic",
  hackathon: "Hackathon",
  unknown: "Not sure",
};
const EMPLOYMENT_TEXT: Record<RoleEmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  freelance: "Freelance",
  contract: "Contract",
  internship: "Internship",
  unknown: "Not sure",
};

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

type Section = "projects" | "experience";
type Keys = Record<Section, string[]>;

/** The collapsed card, its actions, and (when open) the editor passed in as children. */
function CardShell({
  id,
  heading,
  meta,
  summary,
  skills,
  domains,
  links,
  hidden,
  namesRemoved,
  open,
  hasError,
  onToggleOpen,
  onRemove,
  onToggleHidden,
  noun,
  children,
}: {
  id: string;
  heading: string;
  meta: string;
  summary: string;
  skills: readonly string[];
  domains: readonly string[];
  links: readonly string[];
  hidden: boolean;
  namesRemoved: boolean;
  open: boolean;
  hasError: boolean;
  onToggleOpen: () => void;
  onRemove: () => void;
  onToggleHidden: () => void;
  noun: string;
  children: ReactNode;
}) {
  return (
    <li
      className={cn(
        "rounded-xl border bg-background p-4",
        hasError ? "border-destructive" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            className={cn(
              "text-sm font-semibold break-words",
              hidden && "text-muted-foreground",
            )}
          >
            {heading}
          </h3>
          {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
        </div>
        <div className="flex shrink-0 gap-1">
          {!(open && hasError) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={open}
              aria-controls={`${id}-editor`}
              onClick={onToggleOpen}
            >
              {open ? "Done" : "Edit"}
              <span className="sr-only"> {heading}</span>
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            Remove<span className="sr-only"> {heading}</span>
          </Button>
        </div>
      </div>

      {namesRemoved && (
        <p className="mt-2 rounded-lg bg-flare-50 px-2.5 py-1.5 text-xs">
          Client name removed. Check nothing is left.
        </p>
      )}

      {!open && (
        <div className="mt-2 space-y-2 text-sm">
          {summary && (
            <p className={cn(hidden && "text-muted-foreground")}>{summary}</p>
          )}
          {(skills.length > 0 || domains.length > 0) && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
              {[...skills, ...domains].map((t) => (
                <li
                  key={t}
                  className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {t}
                </li>
              ))}
            </ul>
          )}
          {links.length > 0 && (
            <ul className="space-y-0.5 text-xs">
              {links.map((l, i) => {
                const checked = checkLink(l);
                return (
                  <li key={i} className="break-all">
                    {checked.ok ? (
                      <a
                        href={checked.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="underline underline-offset-4"
                      >
                        {l}
                      </a>
                    ) : (
                      l
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {open && (
        <div id={`${id}-editor`} className="mt-4 space-y-5">
          {children}
        </div>
      )}

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!hidden}
          onChange={onToggleHidden}
          className="size-4 accent-ink"
        />
        Use in replies
        <span className="sr-only">
          {" "}
          ({noun}: {heading})
        </span>
      </label>
    </li>
  );
}

export function WorkStep({
  init,
  notice = null,
}: {
  init: StepFormInit<"work">;
  /** Set when the resume import couldn't read projects or experience. */
  notice?: string | null;
}) {
  const form = useStepForm(init);
  const v = form.value;
  // Local keys for the cards (never saved). Restore and discard can change the lists, so the
  // keys are always fitted to the lists' lengths.
  const [stored, setKeys] = useState<Keys>({
    projects: init.data.projects.map((_, i) => `project-${i}`),
    experience: init.data.experience.map((_, i) => `role-${i}`),
  });
  const keys: Keys = {
    projects: fitKeys(stored.projects, v.projects.length, "project"),
    experience: fitKeys(stored.experience, v.experience.length, "role"),
  };
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const counter = useRef(0);
  const newKey = (prefix: string) => `${prefix}-new-${counter.current++}`;

  const toggleOpen = (key: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const focusSoon = (id: string) =>
    requestAnimationFrame(() => document.getElementById(id)?.focus());

  function add(section: Section) {
    if (section === "projects") {
      const next = addProject(v.projects);
      if (next === v.projects) return;
      const key = newKey("project");
      setKeys({ ...keys, projects: [...keys.projects, key] });
      form.update({ projects: next });
      setOpen((o) => new Set(o).add(key));
      focusSoon(`${key}-title`);
    } else {
      const next = addRole(v.experience);
      if (next === v.experience) return;
      const key = newKey("role");
      setKeys({ ...keys, experience: [...keys.experience, key] });
      form.update({ experience: next });
      setOpen((o) => new Set(o).add(key));
      focusSoon(`${key}-title`);
    }
  }
  function remove(section: Section, index: number) {
    setKeys({ ...keys, [section]: removeAt(keys[section], index) });
    form.update(
      section === "projects"
        ? { projects: removeAt(v.projects, index) }
        : { experience: removeAt(v.experience, index) },
    );
    focusSoon(section === "projects" ? "add-project" : "add-role");
  }
  const patchProject = (i: number, patch: Partial<ProjectCard>) =>
    form.update({
      projects: v.projects.map((p, j) => (j === i ? editEntry(p, patch) : p)),
    });
  const patchRole = (i: number, patch: Partial<RoleCard>) =>
    form.update({
      experience: v.experience.map((r, j) =>
        j === i ? editEntry(r, patch) : r,
      ),
    });
  const skillNames = (ids: readonly string[]) =>
    ids.map((id) => SKILL_BY_ID.get(id)?.name ?? id);
  const domainLabels = (ids: readonly string[]) =>
    ids.map((id) => DOMAINS.find((d) => d.id === id)?.label ?? id);

  const empty = v.projects.length === 0 && v.experience.length === 0;
  const projectsError = form.errorFor("projects");
  const rolesError = form.errorFor("experience");

  function renderProject(p: ProjectCard, i: number) {
    const key = keys.projects[i]!;
    const path = `projects.${i}`;
    const err = (f: string) => form.errorFor(`${path}.${f}`);
    const hasError = !!form.errorFor(path);
    const isOpen = open.has(key) || hasError;
    const kindText = KIND_TEXT[p.kind];
    const meta = [
      p.kind !== "unknown" ? kindText : "",
      p.year ? String(p.year) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <CardShell
        key={key}
        id={key}
        noun="project"
        heading={p.title || "Untitled project"}
        meta={meta}
        summary={p.summary}
        skills={skillNames(p.skills)}
        domains={domainLabels(p.domains)}
        links={p.links}
        hidden={p.hidden}
        namesRemoved={p.namesRemoved}
        open={isOpen}
        hasError={hasError}
        onToggleOpen={() => toggleOpen(key)}
        onRemove={() => remove("projects", i)}
        onToggleHidden={() =>
          form.update({
            projects: v.projects.map((x, j) => (j === i ? toggleHidden(x) : x)),
          })
        }
      >
        <Field id={`${key}-title`} label="Project name" error={err("title")}>
          <Input
            {...controlProps(`${key}-title`, err("title"))}
            value={p.title}
            autoComplete="off"
            onChange={(e) => patchProject(i, { title: e.target.value })}
            className="h-11 text-base md:text-sm"
          />
        </Field>
        <Field
          id={`${key}-summary`}
          label="What it is, in one line"
          hint={`${p.summary.length}/${WORK_LIMITS.entrySummary}. Leave out client names.`}
          error={err("summary")}
        >
          <Textarea
            {...controlProps(`${key}-summary`, err("summary"), "hint")}
            rows={2}
            value={p.summary}
            onChange={(e) => patchProject(i, { summary: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id={`${key}-kind`} label="Kind of project" error={err("kind")}>
            <select
              {...controlProps(`${key}-kind`, err("kind"))}
              value={p.kind}
              onChange={(e) =>
                patchProject(i, { kind: e.target.value as ProjectKind })
              }
              className={selectClass}
            >
              {PROJECT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_TEXT[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${key}-role`} label="Your part" error={err("role")}>
            <select
              {...controlProps(`${key}-role`, err("role"))}
              value={p.role}
              onChange={(e) =>
                patchProject(i, { role: e.target.value as ProjectRole })
              }
              className={selectClass}
            >
              {PROJECT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_TEXT[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${key}-year`} label="Year" optional error={err("year")}>
            <Input
              {...controlProps(`${key}-year`, err("year"))}
              inputMode="numeric"
              autoComplete="off"
              value={p.year === null ? "" : String(p.year)}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                patchProject(i, { year: digits ? Number(digits) : null });
              }}
              className="h-11 text-base md:text-sm"
            />
          </Field>
        </div>
        <LineList
          id={`${key}-outcomes`}
          legend="Result"
          addLabel="Add a result"
          lines={p.outcomes}
          max={WORK_LIMITS.outcomes}
          onChange={(outcomes) => patchProject(i, { outcomes })}
          errorFor={(n) => err(n === undefined ? "outcomes" : `outcomes.${n}`)}
          placeholder="e.g. Cut page load time by 40%"
        />
        <LineList
          id={`${key}-links`}
          legend="Link"
          addLabel="Add a link"
          lines={p.links}
          max={WORK_LIMITS.links}
          onChange={(links) => patchProject(i, { links })}
          errorFor={(n) => err(n === undefined ? "links" : `links.${n}`)}
          placeholder="site.io/my-project"
          checkLinks
        />
        <SkillPicker
          id={`${key}-skills`}
          value={p.skills}
          onChange={(skills) => patchProject(i, { skills })}
          error={err("skills")}
        />
        <DomainChips
          id={`${key}-domains`}
          value={p.domains}
          onChange={(domains) => patchProject(i, { domains })}
          error={err("domains")}
        />
      </CardShell>
    );
  }

  function renderRole(r: RoleCard, i: number) {
    const key = keys.experience[i]!;
    const path = `experience.${i}`;
    const err = (f: string) => form.errorFor(`${path}.${f}`);
    const hasError = !!form.errorFor(path);
    const isOpen = open.has(key) || hasError;
    const meta = [
      r.employmentType !== "unknown" ? EMPLOYMENT_TEXT[r.employmentType] : "",
      formatDates(r.start, r.end, r.current),
    ]
      .filter(Boolean)
      .join(" · ");
    const showOrganisation = !ORGANISATION_FREE_TYPES.has(r.employmentType);
    const heading = r.title
      ? r.organisation && showOrganisation
        ? `${r.title}, ${r.organisation}`
        : r.title
      : "Untitled role";
    return (
      <CardShell
        key={key}
        id={key}
        noun="role"
        heading={heading}
        meta={meta}
        summary={r.organisationDescription || r.summary}
        skills={skillNames(r.skills)}
        domains={domainLabels(r.domains)}
        links={[]}
        hidden={r.hidden}
        namesRemoved={r.namesRemoved}
        open={isOpen}
        hasError={hasError}
        onToggleOpen={() => toggleOpen(key)}
        onRemove={() => remove("experience", i)}
        onToggleHidden={() =>
          form.update({
            experience: v.experience.map((x, j) =>
              j === i ? toggleHidden(x) : x,
            ),
          })
        }
      >
        <Field id={`${key}-title`} label="Job title" error={err("title")}>
          <Input
            {...controlProps(`${key}-title`, err("title"))}
            value={r.title}
            autoComplete="off"
            onChange={(e) => patchRole(i, { title: e.target.value })}
            className="h-11 text-base md:text-sm"
          />
        </Field>
        <Field
          id={`${key}-type`}
          label="Type of work"
          error={err("employmentType")}
        >
          <select
            {...controlProps(`${key}-type`, err("employmentType"))}
            value={r.employmentType}
            onChange={(e) =>
              form.update({
                experience: v.experience.map((x, j) =>
                  j === i
                    ? setEmploymentType(x, e.target.value as RoleEmploymentType)
                    : x,
                ),
              })
            }
            className={selectClass}
          >
            {ROLE_EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_TEXT[t]}
              </option>
            ))}
          </select>
        </Field>
        {showOrganisation && (
          <Field
            id={`${key}-org`}
            label="Employer"
            optional
            hint="Replies only name it if you turn that on below."
            error={err("organisation")}
          >
            <Input
              {...controlProps(`${key}-org`, err("organisation"), "hint")}
              value={r.organisation ?? ""}
              autoComplete="off"
              onChange={(e) =>
                patchRole(i, { organisation: e.target.value || null })
              }
              className="h-11 text-base md:text-sm"
            />
          </Field>
        )}
        <Field
          id={`${key}-orgdesc`}
          label="Describe the organisation"
          hint={`Replies use this, like “a fintech payments company”. ${r.organisationDescription.length}/${WORK_LIMITS.orgDescription}`}
          error={err("organisationDescription")}
        >
          <Input
            {...controlProps(
              `${key}-orgdesc`,
              err("organisationDescription"),
              "hint",
            )}
            value={r.organisationDescription}
            autoComplete="off"
            onChange={(e) =>
              patchRole(i, { organisationDescription: e.target.value })
            }
            className="h-11 text-base md:text-sm"
          />
        </Field>
        <DateFields
          id={`${key}-start`}
          legend="Start"
          value={r.start}
          onChange={(start) => patchRole(i, { start })}
          error={err("start")}
        />
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={r.current}
            onChange={(e) =>
              patchRole(i, {
                current: e.target.checked,
                ...(e.target.checked && { end: null }),
              })
            }
            className="size-4 accent-ink"
          />
          I work here now
        </label>
        {!r.current && (
          <DateFields
            id={`${key}-end`}
            legend="End"
            value={r.end}
            onChange={(end) => patchRole(i, { end })}
            error={err("end")}
          />
        )}
        <Field
          id={`${key}-summary`}
          label="What you did, in one line"
          optional
          hint={`${r.summary.length}/${WORK_LIMITS.entrySummary}. Leave out client names.`}
          error={err("summary")}
        >
          <Textarea
            {...controlProps(`${key}-summary`, err("summary"), "hint")}
            rows={2}
            value={r.summary}
            onChange={(e) => patchRole(i, { summary: e.target.value })}
          />
        </Field>
        <LineList
          id={`${key}-highlights`}
          legend="Highlight"
          addLabel="Add a highlight"
          lines={r.highlights}
          max={WORK_LIMITS.highlights}
          onChange={(highlights) => patchRole(i, { highlights })}
          errorFor={(n) =>
            err(n === undefined ? "highlights" : `highlights.${n}`)
          }
          placeholder="e.g. Led a migration to a new payments provider"
        />
        <SkillPicker
          id={`${key}-skills`}
          value={r.skills}
          onChange={(skills) => patchRole(i, { skills })}
          error={err("skills")}
        />
        <DomainChips
          id={`${key}-domains`}
          value={r.domains}
          onChange={(domains) => patchRole(i, { domains })}
          error={err("domains")}
        />
      </CardShell>
    );
  }

  return (
    <>
      <StepHeader
        title="Projects & experience"
        description="Past work helps your replies show proof. Everything here is optional."
      />
      <RestoreBanner form={form} />
      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-bone px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      <p className="mb-6 rounded-lg bg-bone px-3 py-2 text-sm">
        Replies are public. We remove client names we find; check nothing is
        left.
      </p>
      <fieldset disabled={!!form.pending} className="space-y-8">
        {empty && (
          <p className="text-sm text-muted-foreground">
            No resume? Add a project or a role by hand, or skip this for now.
          </p>
        )}

        <section aria-labelledby="work-projects" className="space-y-3">
          <h2 id="work-projects" className="text-base font-semibold">
            Projects ({v.projects.length}/{WORK_LIMITS.projects})
          </h2>
          {projectsError && !form.errorFor("projects.0") && (
            <p role="alert" className="text-sm text-danger">
              {projectsError}
            </p>
          )}
          {v.projects.length > 0 && (
            <ul className="space-y-3">{v.projects.map(renderProject)}</ul>
          )}
          <Button
            id="add-project"
            type="button"
            variant="outline"
            disabled={v.projects.length >= WORK_LIMITS.projects}
            onClick={() => add("projects")}
          >
            <Plus aria-hidden="true" /> Add a project
          </Button>
        </section>

        <section aria-labelledby="work-roles" className="space-y-3">
          <h2 id="work-roles" className="text-base font-semibold">
            Experience ({v.experience.length}/{WORK_LIMITS.roles})
          </h2>
          {rolesError && !form.errorFor("experience.0") && (
            <p role="alert" className="text-sm text-danger">
              {rolesError}
            </p>
          )}
          {v.experience.length > 0 && (
            <ul className="space-y-3">{v.experience.map(renderRole)}</ul>
          )}
          <Button
            id="add-role"
            type="button"
            variant="outline"
            disabled={v.experience.length >= WORK_LIMITS.roles}
            onClick={() => add("experience")}
          >
            <Plus aria-hidden="true" /> Add a role
          </Button>

          <FieldGroup
            legend="Employer names"
            errorKey="mentionEmployers"
            error={form.errorFor("mentionEmployers")}
          >
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                role="switch"
                checked={v.mentionEmployers}
                aria-describedby="mention-employers-hint"
                onChange={(e) =>
                  form.update({ mentionEmployers: e.target.checked })
                }
                className="mt-0.5 size-4 accent-ink"
              />
              <span>
                Mention employer names in replies
                <span
                  id="mention-employers-hint"
                  className="block text-xs text-muted-foreground"
                >
                  Off: replies say &ldquo;a fintech payments company&rdquo;. You
                  can still change it for a single reply later.
                </span>
              </span>
            </label>
          </FieldGroup>
        </section>
      </fieldset>
      <StepActions
        form={form}
        back="skills"
        nextLabel={empty ? "Skip for now" : "Next"}
      />
    </>
  );
}
