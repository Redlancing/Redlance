"use client";

import { CATEGORIES, SKILL_BY_ID } from "@redlance/core";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ReviewData } from "@/server/onboarding/page-data";
import { LEVEL_TEXT } from "./basics-step";
import { useCountryOptions } from "./browser-intl";
import { formatMoney, workSummary } from "./review-format";
import { StepHeader } from "./step-header";

const RATE_TYPE_TEXT = {
  hourly: "Hourly",
  fixed: "Fixed price",
  either: "Hourly or fixed",
} as const;

function Section({
  title,
  editHref,
  editLabel,
  children,
}: {
  title: string;
  editHref: string;
  editLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border py-5 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <Link
          href={editHref}
          aria-label={editLabel}
          className="text-sm text-stone underline underline-offset-4 hover:text-foreground"
        >
          Edit
        </Link>
      </div>
      <div className="mt-2 space-y-1 text-sm text-foreground">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p>
      <span className="text-muted-foreground">{label}: </span>
      {children}
    </p>
  );
}

export function ReviewStep({
  data,
  email,
  subredditCount,
}: {
  data: ReviewData;
  email: string;
  /** Passed from the server so the catalogue isn't shipped to the browser. */
  subredditCount: number;
}) {
  const router = useRouter();
  const countries = useCountryOptions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { basics, skills, work, rates } = data;
  const githubUsername = data.import.githubUsername;
  const jobTypes = basics.categories.map(
    (id) => CATEGORIES.find((c) => c.id === id)?.name ?? id,
  );
  const country =
    countries?.find((c) => c.code === basics.country)?.name ?? basics.country;
  const named = skills.skills.map((s) => ({
    name: SKILL_BY_ID.get(s.id)?.name ?? s.id,
    level: s.level,
  }));
  const core = named.filter((s) => s.level === "core").map((s) => s.name);
  const others = named.filter((s) => s.level !== "core").map((s) => s.name);

  async function finish() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/onboarding/finish", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.redirect) {
        router.replace(body.redirect);
        router.refresh();
        return;
      }
      if (
        res.status === 409 &&
        body?.error?.code === "STEP_ORDER" &&
        body.error.details?.resumeAt
      ) {
        router.push(`/onboarding/${body.error.details.resumeAt}`);
        return;
      }
      setError(body?.error?.message ?? "Something went wrong. Try again.");
    } catch {
      setError("Couldn't reach Redlance. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <>
      <StepHeader
        title="Check and finish"
        description="Finishing starts your 5-day trial."
      />

      <Section
        title="GitHub"
        editHref="/onboarding/import"
        editLabel="Edit GitHub"
      >
        {githubUsername ? (
          <a
            href={`https://github.com/${githubUsername}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            github.com/{githubUsername}
          </a>
        ) : (
          <p className="text-muted-foreground">Not added</p>
        )}
      </Section>

      <Section
        title="Basics"
        editHref="/onboarding/basics"
        editLabel="Edit basics"
      >
        <Row label="Name">{basics.displayName}</Row>
        <Row label="Headline">{basics.headline || "None"}</Row>
        <Row label="Job types">{jobTypes.join(", ")}</Row>
        <Row label="Experience">{LEVEL_TEXT[basics.experienceLevel][0]}</Row>
        <Row label="Country">{country}</Row>
        <Row label="Time zone">{basics.timeZone}</Row>
      </Section>

      <Section
        title="Skills"
        editHref="/onboarding/skills"
        editLabel="Edit skills"
      >
        <Row label="Core">{core.join(", ")}</Row>
        {others.length > 0 && <Row label="Others">{others.join(", ")}</Row>}
      </Section>

      <Section
        title="Projects & experience"
        editHref="/onboarding/work"
        editLabel="Edit projects and experience"
      >
        <p>{workSummary(work)}</p>
        {work.projects.length > 0 && (
          <Row label="Projects">
            {work.projects.map((p) => p.title).join(", ")}
          </Row>
        )}
        {work.experience.length > 0 && (
          <Row label="Roles">
            {work.experience.map((r) => r.title).join(", ")}
          </Row>
        )}
      </Section>

      <Section
        title="Rates & filters"
        editHref="/onboarding/rates"
        editLabel="Edit rates and filters"
      >
        <Row label="Minimum budget">
          {formatMoney(rates.minRate, rates.currency)}
        </Row>
        <Row label="Rate type">{RATE_TYPE_TEXT[rates.rateType]}</Row>
        <Row label="Remote only">{rates.remoteOnly ? "Yes" : "No"}</Row>
      </Section>

      <div className="mt-2 rounded-xl border border-flare-100 bg-flare-50 p-4 text-sm">
        <h2 className="text-base font-semibold text-foreground">
          What happens next
        </h2>
        <p className="mt-2">
          Redlance watches {subredditCount} hiring subreddits and shows you the
          posts that match your skills.
        </p>
        <p className="mt-2">
          New matches are emailed to {email}. You can add Telegram later from
          the dashboard.
        </p>
      </div>

      <div aria-live="polite" className="mt-4 min-h-5 text-sm">
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>

      <div className="mt-2 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/onboarding/rates"
          className="text-sm text-stone underline underline-offset-4 hover:text-foreground"
        >
          Back
        </Link>
        <Button
          size="xl"
          onClick={finish}
          disabled={pending}
          className="w-full sm:w-auto"
        >
          {pending && (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          )}
          {pending ? "Finishing…" : "Finish"}
        </Button>
      </div>
    </>
  );
}
