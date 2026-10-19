"use client";

import type { PageId } from "@redlance/core";
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
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
import type { StepForm } from "./use-step-form";

export function RestoreBanner({ form }: { form: StepForm }) {
  if (!form.restorable) return null;
  return (
    <div
      role="status"
      className="mb-6 flex flex-col gap-3 rounded-xl border border-flare-100 bg-flare-50 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p>You have unsaved changes on this step from earlier.</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={form.restore}>
          Restore them
        </Button>
        <Button size="sm" variant="ghost" onClick={form.dismissRestore}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export function StepActions({
  form,
  back,
  nextLabel = "Next",
  showDraft = true,
  nextDisabled = false,
}: {
  form: StepForm;
  back: PageId | null;
  nextLabel?: string;
  showDraft?: boolean;
  /** Locks Next (and Skip) while something must finish first, e.g. an import. */
  nextDisabled?: boolean;
}) {
  const router = useRouter();
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  function go(href: string) {
    if (form.dirty) setLeaveTo(href);
    else router.push(href);
  }

  return (
    <>
      <div aria-live="polite" className="mt-6 min-h-5 text-sm">
        {form.notice?.kind === "saved" && (
          <p className="text-success">
            {form.notice.changes ? "Changes saved." : "Draft saved."}
          </p>
        )}
        {form.notice?.kind === "invalid" && (
          <p role="alert" className="text-danger">
            Some fields need attention.
          </p>
        )}
        {form.notice?.kind === "error" && (
          <p role="alert" className="text-danger">
            {form.notice.message}
          </p>
        )}
        {form.notice?.kind === "conflict" && (
          <p role="alert" className="text-danger">
            This step was saved in another tab.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => window.location.reload()}
            >
              Reload to get the latest version
            </button>{" "}
            — your edits here will be offered back.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {back && (
            <Button
              variant="ghost"
              size="lg"
              onClick={() => go(`/onboarding/${back}`)}
            >
              <ArrowLeft aria-hidden="true" /> Back
            </Button>
          )}
          {form.resumeAt === "review" && (
            <Button
              variant="ghost"
              size="lg"
              onClick={() => go("/onboarding/review")}
            >
              Back to review
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          {showDraft && (
            <Button
              variant="outline"
              size="lg"
              onClick={form.saveDraft}
              disabled={!!form.pending || !form.dirty}
            >
              {form.pending === "draft" && (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              )}
              {form.completed ? "Save changes" : "Save draft"}
            </Button>
          )}
          <Button
            size="lg"
            onClick={form.next}
            disabled={!!form.pending || nextDisabled}
          >
            {form.pending === "complete" && (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            )}
            {nextLabel}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      <AlertDialog
        open={leaveTo !== null}
        onOpenChange={(open) => !open && setLeaveTo(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save your changes first?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ve changed this step since it was last saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                form.discard();
                if (leaveTo) router.push(leaveTo);
              }}
            >
              Discard
            </Button>
            <Button
              onClick={async () => {
                const href = leaveTo;
                if ((await form.saveDraft()) && href) router.push(href);
                else setLeaveTo(null); // errors are now shown on the form
              }}
            >
              {form.completed ? "Save changes" : "Save draft"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
