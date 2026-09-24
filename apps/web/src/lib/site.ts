// Copy that must match word for word everywhere (see CLAUDE.md, "Brand, copy and marketing site").
export const site = {
  name: "Redlance",
  oneLiner:
    "Redlance is an AI tool that finds freelance jobs on Reddit, matches them to your skills, and drafts replies in your voice.",
  promise:
    "See the right Reddit gigs first, and reply in under two minutes with a message that sounds like you.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
} as const;
