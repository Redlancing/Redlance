"use client";

import { checkGithubInput, pageIndex } from "@redlance/core";
import { cn } from "cn";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ImportSummary } from "@/server/onboarding/imports";
import { Field, controlProps } from "./field";
import { lookupGithubUser, type GithubLookup } from "./github-lookup";
import { describeImports, importErrorMessage } from "./import-status";
import { ResumeDrop } from "./resume-drop";
import { StepActions } from "./step-actions";
import { StepHeader } from "./step-header";
import { uploadResume, type UploadError } from "./upload";
import { useImportJobs } from "./use-import-jobs";
import { useStepForm, type StepFormInit } from "./use-step-form";

const TONE_CLASS = {
  info: "text-foreground",
  success: "text-success",
  warning: "text-foreground",
  error: "text-danger",
} as const;

/** Statuses whose sentence we own; anything else shows the server's message. */
function startErrorMessage(
  status: number,
  code: string | null,
  message: string,
) {
  if (status === 413 || status === 415 || status === 429)
    return importErrorMessage(String(status));
  if (code === "UNSUPPORTED_FILE") return importErrorMessage("415");
  return message;
}

export function ImportStep({
  init,
  imports,
  hasSavedProfileSteps,
}: {
  init: StepFormInit<"import">;
  /** The latest resume and GitHub imports (running ones are picked up again). */
  imports: ImportSummary[];
  /** Basics or Skills rows exist, so a new import would replace them. */
  hasSavedProfileSteps: boolean;
}) {
  const router = useRouter();
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
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [startErrors, setStartErrors] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { jobs, track, clear } = useImportJobs(imports, (finished) => {
    // Later steps read suggestions on the server, so fetch fresh page data.
    router.refresh();
    const suggested = finished.find((j) => j.suggestions?.githubUsername)
      ?.suggestions?.githubUsername;
    if (suggested)
      form.update({ githubUsername: form.value.githubUsername || suggested });
  });
  const view = describeImports(jobs, uploading);
  const busy = view.busy || starting;
  const canImport = !busy && !form.pending && (!!file || !!username);
  const needsConfirm =
    hasSavedProfileSteps || pageIndex(init.resumeAt) > pageIndex("basics");

  async function startGithub(name: string): Promise<string | null> {
    try {
      const res = await fetch("/api/v1/onboarding/imports/github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: name }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        error?: { code?: string; message?: string };
      };
      if (res.status === 202 && body.jobId) {
        track(body.jobId, "github");
        return null;
      }
      if (body.error?.code === "ALREADY_ONBOARDED") router.refresh();
      return startErrorMessage(
        res.status,
        body.error?.code ?? null,
        body.error?.message ?? "Couldn't start the GitHub import.",
      );
    } catch {
      return "Can't reach Redlance. Check your connection and try again.";
    }
  }

  async function startResume(picked: File): Promise<string | null> {
    setUploading(0);
    try {
      const { jobId } = await uploadResume(picked, setUploading);
      track(jobId, "resume");
      setFile(null);
      return null;
    } catch (err) {
      const e = err as UploadError;
      if (e.code === "ALREADY_ONBOARDED") router.refresh();
      return startErrorMessage(e.status, e.code, e.message);
    } finally {
      setUploading(null);
    }
  }

  async function runImport(reset: boolean) {
    setConfirmOpen(false);
    setStarting(true);
    setStartErrors([]);
    try {
      if (reset) {
        const res = await fetch("/api/v1/onboarding/imports/reset", {
          method: "POST",
        }).catch(() => null);
        if (!res?.ok) {
          const body = (await res?.json().catch(() => ({}))) as
            { error?: { code?: string; message?: string } } | undefined;
          if (body?.error?.code === "ALREADY_ONBOARDED") router.refresh();
          setStartErrors([
            body?.error?.message ??
              "Can't reach Redlance. Check your connection and try again.",
          ]);
          return;
        }
      }
      clear();
      const errors = await Promise.all([
        username ? startGithub(username) : null,
        file ? startResume(file) : null,
      ]);
      setStartErrors(errors.filter((e): e is string => e !== null));
    } finally {
      setStarting(false);
    }
  }

  function onImport() {
    if (!canImport) return;
    if (needsConfirm) setConfirmOpen(true);
    else void runImport(false);
  }

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
      <fieldset disabled={!!form.pending || busy} className="space-y-6">
        <ResumeDrop file={file} onFile={setFile} disabled={busy} />
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
        <div className="flex justify-end">
          <Button
            size="lg"
            variant="outline"
            onClick={onImport}
            disabled={!canImport}
          >
            {busy && (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            )}
            Import
          </Button>
        </div>
      </fieldset>
      <div aria-live="polite" className="mt-6 space-y-2 text-sm">
        {view.message && (
          <div
            className={cn(
              "rounded-xl border border-border p-4",
              view.busy ? "bg-bone/60" : "bg-background",
            )}
          >
            <p className={cn("flex items-center gap-2", TONE_CLASS[view.tone])}>
              {view.busy && (
                <LoaderCircle
                  className="size-4 shrink-0 animate-spin"
                  aria-hidden="true"
                />
              )}
              {view.message}
            </p>
            {uploading !== null && (
              <div
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(uploading)}
                className="mt-3 h-1.5 overflow-hidden rounded-full bg-feed"
              >
                <div
                  className="h-full rounded-full bg-flare-500 transition-[width]"
                  style={{ width: `${uploading}%` }}
                />
              </div>
            )}
            {!view.busy && view.tone === "error" && (
              <p className="mt-1 text-muted-foreground">
                Try another file, or continue and fill in the steps yourself.
              </p>
            )}
          </div>
        )}
        {startErrors.map((message) => (
          <p key={message} role="alert" className="text-danger">
            {message}
          </p>
        ))}
      </div>
      <StepActions
        form={form}
        back={null}
        nextLabel={
          busy ||
          form.value.githubUsername?.trim() ||
          jobs.some((j) => j.status === "done")
            ? "Next"
            : "Skip for now"
        }
        showDraft={false}
        nextDisabled={busy}
      />
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace Basics and Skills?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace what&apos;s in Basics and Skills with
              suggestions from the new resume.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button onClick={() => void runImport(true)}>Replace</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
