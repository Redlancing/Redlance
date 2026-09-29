import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/app/sign-out-button";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = {
  title: "Set up your profile",
  robots: { index: false, follow: false },
};

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-1 flex-col bg-cream">
      <header className="flex items-center justify-between px-4 py-4 sm:px-10 sm:py-5">
        <Link
          href="/dashboard"
          aria-label="Redlance dashboard"
          className="inline-flex rounded-md text-2xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Logo />
        </Link>
        <SignOutButton />
      </header>
      <main
        id="main"
        className="flex flex-1 justify-center px-4 pt-2 pb-16 sm:pt-6"
      >
        {children}
      </main>
    </div>
  );
}
