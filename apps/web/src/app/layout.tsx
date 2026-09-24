import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Fraunces, Inter } from "next/font/google";
import { site } from "@/lib/site";
import "./globals.css";

// Inter: UI, body and headlines (opsz switches to the Display cut at large sizes).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  axes: ["opsz"],
});

// Bricolage Grotesque: the "Redlance" wordmark only.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz"],
});

// Fraunces: serif accents such as testimonial quotes.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: "Redlance — Find freelance jobs on Reddit",
    template: "%s · Redlance",
  },
  description: site.oneLiner,
  applicationName: site.name,
  openGraph: {
    type: "website",
    siteName: site.name,
    title: "Redlance — Find freelance jobs on Reddit",
    description: site.oneLiner,
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${bricolage.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
