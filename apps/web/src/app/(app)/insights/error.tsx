"use client";

import { RotateCw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// Covers /insights and /insights/<subreddit>. Locked and not-onboarded are states of the pages,
// so whatever lands here is unexpected (the database, a bug): say so and offer a retry.
export default function InsightsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        Insights
      </h1>
      <div
        role="alert"
        className="mt-8 max-w-lg rounded-[10px] border border-border p-5"
      >
        <p className="text-sm font-medium text-foreground">
          Insights didn&apos;t load.
        </p>
        <p className="mt-1 text-sm text-stone">
          Something went wrong on our side. Try again in a moment.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => retry()}>
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
      </div>
    </div>
  );
}
