"use client";

import { checkGithubInput } from "@redlance/core";
import { FileText } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Field, controlProps } from "./field";
import { lookupGithubUser, type GithubLookup } from "./github-lookup";
import { StepActions } from "./step-actions";
import { StepHeader } from "./step-header";
import { useStepForm, type StepFormInit } from "./use-step-form";

export function ImportStep({ init }: { init: StepFormInit<"import"> }) {
  const form = useStepForm(init, {
    // The field accepts "octocat", "@octocat" or a github.com link; we store the bare username.
    // Anything that fails the check is kept as typed so the schema refuses it on save.
    prepare: (v) => {
      const typed = v.githubUsername?.trim() ?? "";
      const check = checkGithubInput(typed);
      return { githubUsername: check.ok ? check.username : typed };
    },
  });
  const [touched, setTouched] = useState(false);
  const [lookup, setLookup] = useState<{
    username: string;
    status: GithubLookup | "checking";
  } | null>(null);

  const typed = form.value.githubUsername ?? "";
  const check = checkGithubInput(typed);
  const savedError = form.errorFor("githubUsername");
  // Show our specific message once the user has left the field (or tried to continue).
  const error =
    !check.ok && (touched || savedError) ? check.message : savedError;
  const username = check.ok ? check.username : null;
  const lookupStatus =
    lookup && lookup.username === username ? lookup.status : null;
  const hint =
    username && typed.trim() !== username
      ? `We'll save github.com/${username}.`
      : "Optional. Your username or a github.com link. Drafts can link your work from it.";

  function onBlur() {
    setTouched(true);
    if (!username || lookup?.username === username) return;
    setLookup({ username, status: "checking" });
    void lookupGithubUser(username).then((status) =>
      setLookup((current) =>
        current?.username === username ? { username, status } : current,
      ),
    );
  }

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
            onBlur={onBlur}
            className="h-11 text-base md:text-sm"
          />
          {!error && lookupStatus && lookupStatus !== "unknown" && (
            <p role="status" className="text-xs text-muted-foreground">
              {lookupStatus === "checking" && "Checking GitHub…"}
              {lookupStatus === "found" && `Found github.com/${username}.`}
              {lookupStatus === "missing" && (
                <span className="text-danger">
                  No GitHub account called “{username}”. Check the spelling.
                </span>
              )}
            </p>
          )}
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
