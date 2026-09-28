import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/safe-next";
import { getCurrentUser } from "@/server/current-user";
import { getEnv } from "@/server/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Log in",
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(typeof next === "string" ? next : null);

  if (await getCurrentUser()) redirect(nextPath);

  const devMode = getEnv().AUTH_MODE === "dev";

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-2xl border border-border bg-background p-6 shadow-[0_1px_2px_rgb(26_21_18/0.04),0_8px_24px_-12px_rgb(26_21_18/0.12)] sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Log in to Redlance
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          See the right gigs first. New here? Your email creates your account.
        </p>
        <LoginForm nextPath={nextPath} devMode={devMode} />
      </div>
      {devMode && (
        <p className="mt-4 rounded-lg border border-dashed border-feed bg-bone px-3 py-2 text-xs leading-relaxed text-stone">
          <span className="font-medium text-foreground">
            Local dev sign-in.
          </span>{" "}
          No code is emailed and Google is off until Cognito is connected. Any
          email address signs you in.
        </p>
      )}
    </div>
  );
}
