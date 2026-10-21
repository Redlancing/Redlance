// Plans from CLAUDE.md ("Plans"). Prices are in INR; set `price` once decided.
export type Plan = {
  name: string;
  summary: string;
  /** Monthly price in rupees; null means not announced yet. */
  price: number | null;
  features: string[];
  cta?: { label: string; href: string };
  available: boolean;
  highlight?: boolean;
};

export const plans: Plan[] = [
  {
    name: "Free",
    summary: "See how Redlance fits your work.",
    price: 0,
    features: [
      "Alerts 30 to 60 minutes after posting",
      "A few reply drafts a day",
      "Basic reply tracker",
      "Red flags on every post",
      "Connected to the right subreddits",
    ],
    cta: { label: "Start free", href: "/login" },
    available: true,
  },
  {
    name: "Pro",
    summary: "For freelancers who want to reply first.",
    price: null,
    features: [
      "Instant Telegram alerts",
      "Unlimited reply drafts",
      "Voice learning from your edits",
      "Follow-up drafts when a reply goes quiet",
      "Subreddit insights: volume, posted budgets, peak hours",
    ],
    cta: { label: "Join early access", href: "/login" },
    available: true,
    highlight: true,
  },
  {
    name: "Agency",
    summary: "For small teams sharing one pipeline.",
    price: null,
    features: [
      "Multiple freelancer profiles",
      "Route gigs to the right person",
      "Team analytics",
    ],
    available: false,
  },
];
