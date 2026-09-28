import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app/app-sidebar";
import { SignOutButton } from "@/components/app/sign-out-button";
import { Logo } from "@/components/brand/logo";
import { getCurrentUser } from "@/server/current-user";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// The proxy only checks that a session cookie exists; this layout verifies it.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");

  return (
    <div className="flex min-h-svh flex-1">
      <AppSidebar email={user.email} activeHref="/dashboard" />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <Link
            href="/dashboard"
            aria-label="Redlance dashboard"
            className="text-lg"
          >
            <Logo />
          </Link>
          <SignOutButton />
        </header>
        <main id="main" className="flex-1 px-4 py-8 sm:px-8 lg:px-12">
          {children}
        </main>
      </div>
    </div>
  );
}
