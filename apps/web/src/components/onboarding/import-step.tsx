"use client";

import { parseGithubUsername } from "@redlance/core";
import { FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, controlProps } from "./field";
import { StepActions } from "./step-actions";
import { StepHeader } from "./step-header";
import { useStepForm, type StepFormInit } from "./use-step-form";

export function ImportStep({ init }: { init: StepFormInit<"import"> }) {
  const form = useStepForm(init, {
    // The field accepts "octocat", "@octocat" or a github.com URL; we store the bare username.
    // Unparseable text is kept as typed so the schema shows the error.
    prepare: (v) => {
      const typed = v.githubUsername?.trim() ?? "";
      return {
        githubUsername: typed ? (parseGithubUsername(typed) ?? typed) : null,
      };
    },
  });
  const error = form.errorFor("githubUsername");
  const hint =
    "Optional. Your username or a github.com link. Drafts can link your work from it.";

  return (
    <>
      <StepHeader
        title="Let's set up your profile"
        description="Redlance matches Reddit hiring posts to your skills, so it needs to know what you do. It takes about three minutes, and you can change everything later."
      />
      <fieldset disabled={!!form.pending} className="space-y-6">
        <Field
          id="githubUsername"
          label="GitHub"
          optional
          hint={hint}
          error={error}
        >
          <Input
            {...controlProps("githubUsername", error, hint)}
            autoComplete="off"
            spellCheck={false}
            placeholder="octocat or github.com/octocat"
            value={form.value.githubUsername ?? ""}
            onChange={(e) =>
              form.update({ githubUsername: e.target.value || null })
            }
            className="h-11 text-base md:text-sm"
          />
        </Field>
        <div className="rounded-xl border border-dashed border-feed bg-bone/60 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileText className="size-4" aria-hidden="true" /> Import a resume
            <span className="ml-auto rounded-full bg-feed px-2 py-0.5 text-[11px] font-medium text-stone">
              Coming soon
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            PDF or Word; we&apos;ll pre-fill the next steps for you.
          </p>
        </div>
      </fieldset>
      <StepActions
        form={form}
        back={null}
        nextLabel={form.value.githubUsername?.trim() ? "Next" : "Skip for now"}
        showDraft={false}
      />
    </>
  );
}
