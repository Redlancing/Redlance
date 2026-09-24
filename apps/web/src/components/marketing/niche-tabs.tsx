"use client";

import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Frame, SectionChip, TwoToneHeading } from "./primitives";

// Example matches are sample content, one per niche.
const niches = [
  {
    id: "web",
    label: "Web developers",
    blurb:
      "Next.js, React, Shopify and WordPress work, from quick fixes to full builds.",
    subreddits: [
      "r/forhire",
      "r/hiring",
      "r/hireaprogrammer",
      "r/freelance_forhire",
    ],
    href: "/reddit-web-developer-gigs",
    link: "Web developer gigs on Reddit",
    example: {
      score: 94,
      title: "Next.js developer to rebuild our course landing page",
      meta: "r/forhire, posted budget $600",
      why: "Next.js and Tailwind are your main stack.",
    },
  },
  {
    id: "video",
    label: "Video editors",
    blurb:
      "YouTube videos, shorts, podcasts and ads, from one-off edits to weekly work.",
    subreddits: ["r/VideoEditingRequests", "r/forhire", "r/hiring"],
    href: "/reddit-video-editing-jobs",
    link: "Video editing jobs on Reddit",
    example: {
      score: 91,
      title: "Editor for weekly 60-second shorts cut from our podcast",
      meta: "r/VideoEditingRequests, posted budget $30 per video",
      why: "Short-form podcast edits are in your portfolio.",
    },
  },
  {
    id: "design",
    label: "Designers",
    blurb: "Logos, brand identities, UI screens and social graphics.",
    subreddits: ["r/DesignJobs", "r/forhire", "r/PhotoshopRequest"],
    href: "/reddit-freelance-jobs",
    link: "Freelance design jobs on Reddit",
    example: {
      score: 89,
      title: "Logo and brand kit for a Bengaluru coffee roaster",
      meta: "r/DesignJobs, posted budget ₹18,000",
      why: "You've done brand identities for food and drink brands.",
    },
  },
  {
    id: "writing",
    label: "Writers",
    blurb: "Blog posts, landing page copy, newsletters and ghostwriting.",
    subreddits: ["r/HireaWriter", "r/forhire", "r/hiring"],
    href: "/reddit-freelance-jobs",
    link: "Freelance writing jobs on Reddit",
    example: {
      score: 86,
      title: "Writer for four SaaS blog posts a month",
      meta: "r/HireaWriter, posted budget $0.08 per word",
      why: "You write long-form content for SaaS companies.",
    },
  },
];

export function NicheTabs() {
  return (
    <section
      aria-labelledby="niches-heading"
      className="border-b border-border bg-background"
    >
      <Frame>
        <div className="flex flex-col items-start gap-5 px-4 py-20 sm:px-12 sm:py-24 lg:px-16">
          <SectionChip>Redlance for</SectionChip>
          <TwoToneHeading
            id="niches-heading"
            lead="Built for how you freelance."
            rest="Pick your skills, and Redlance watches the subreddits where that work gets posted."
            className="max-w-[44rem]"
          />
        </div>

        <Tabs defaultValue="web" className="gap-0">
          <TabsList
            variant="line"
            className="grid w-full grid-cols-2 gap-0 rounded-none border-t border-border p-0 group-data-horizontal/tabs:h-auto md:grid-cols-4"
          >
            {niches.map((niche) => (
              <TabsTrigger
                key={niche.id}
                value={niche.id}
                className="h-16 rounded-none border-0 border-b border-border text-[15px] text-muted-foreground not-last:border-r after:hidden hover:bg-muted/60 focus-visible:ring-inset max-md:nth-2:border-r-0 md:border-b-0 data-active:bg-cream data-active:text-foreground"
              >
                {niche.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {niches.map((niche) => (
            <TabsContent
              key={niche.id}
              value={niche.id}
              className="grid border-border text-base md:grid-cols-2 md:border-t"
            >
              <div className="flex flex-col gap-6 border-border px-4 py-12 sm:px-12 md:border-r lg:px-16">
                <p className="max-w-[28rem] text-lg leading-relaxed">
                  {niche.blurb}
                </p>
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground">
                    Subreddits we watch for this
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {niche.subreddits.map((sub) => (
                      <li
                        key={sub}
                        className="rounded-md border border-border px-2 py-1 text-sm"
                      >
                        {sub}
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  href={niche.href}
                  className="group inline-flex w-fit items-center gap-1.5 font-medium text-flare-700 underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  {niche.link}
                  <ArrowRightIcon
                    aria-hidden="true"
                    className="size-4 transition-transform duration-300 ease-snappy group-hover:translate-x-0.5"
                  />
                </Link>
              </div>

              <div className="flex items-center justify-center border-t border-border bg-cream bg-[radial-gradient(rgb(26_21_18/0.07)_1px,transparent_1px)] [background-size:16px_16px] px-4 py-12 sm:px-12 md:border-t-0">
                <figure className="w-full max-w-md rounded-xl border border-border bg-background p-4 text-sm shadow-[0_24px_48px_-32px_rgb(26_21_18/0.35)]">
                  <figcaption className="text-xs text-muted-foreground">
                    Example match
                  </figcaption>
                  <div className="mt-3 flex items-start gap-3">
                    <span className="rounded-md bg-flare-600 px-1.5 py-0.5 text-sm font-semibold text-white tabular-nums">
                      {niche.example.score}
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="leading-snug font-semibold">
                        {niche.example.title}
                      </p>
                      <p className="text-muted-foreground">
                        {niche.example.meta}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 border-t border-border pt-3 text-muted-foreground">
                    <span className="font-medium text-foreground">Why: </span>
                    {niche.example.why}
                  </p>
                </figure>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </Frame>
    </section>
  );
}
