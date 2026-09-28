import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-1 flex-col bg-cream">
      <header className="px-6 py-5 sm:px-10">
        <Link
          href="/"
          aria-label="Redlance home"
          className="inline-flex rounded-md text-2xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Logo />
        </Link>
      </header>
      <main
        id="main"
        className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-16 sm:items-center sm:pt-0"
      >
        {children}
      </main>
    </div>
  );
}
