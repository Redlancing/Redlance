// Marketing navigation. Items without an href are shown as "Soon" and are not links.

export type NavItem = {
  title: string;
  description?: string;
  href?: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const announcement = {
  // Bump the id when the message changes so people who dismissed the old one see the new one.
  id: "early-access-2026-09",
  text: "Early access is open for freelancers in India",
  href: "/signup",
};

export const productMenu: { columns: NavGroup[]; side: NavGroup[] } = {
  columns: [
    {
      label: "Find",
      items: [
        {
          title: "Hiring feed",
          description: "Every [Hiring] post from the subreddits you pick",
          href: "/#find",
        },
        {
          title: "Match scores",
          description: "A 0–100 score and a one-line reason",
          href: "/#match",
        },
        {
          title: "Red flags",
          description: "Unpaid and vague posts marked for you",
          href: "/#match",
        },
      ],
    },
    {
      label: "Reply",
      items: [
        {
          title: "Drafts in your voice",
          description: "Short replies that sound like you",
          href: "/#draft",
        },
        {
          title: "Telegram alerts",
          description: "Good matches on your phone in minutes",
          href: "/#alerts",
        },
        {
          title: "Reply tracker",
          description: "Sent, replied, hired, paid",
          href: "/#track",
        },
      ],
    },
    {
      label: "Grow",
      items: [
        {
          title: "Follow-ups",
          description: "Reminders when a client goes quiet",
        },
        {
          title: "Posted budgets",
          description: "What similar gigs are offering",
        },
        {
          title: "Client memory",
          description: "See when a client has posted before",
        },
      ],
    },
  ],
  side: [
    {
      label: "Redlance for",
      items: [
        { title: "Web developers", href: "/reddit-web-developer-gigs" },
        { title: "Video editors", href: "/reddit-video-editing-jobs" },
        { title: "All freelancers", href: "/reddit-freelance-jobs" },
      ],
    },
    {
      label: "Get started",
      items: [
        { title: "How it works", href: "/#how-it-works" },
        {
          title: "Best subreddits for freelancers",
          href: "/best-subreddits-for-freelancers",
        },
      ],
    },
  ],
};

export const primaryLinks: NavItem[] = [
  { title: "How it works", href: "/#how-it-works" },
  { title: "Subreddits", href: "/best-subreddits-for-freelancers" },
  { title: "Pricing", href: "/#pricing" },
];

export const authLinks = {
  logIn: { title: "Log in", href: "/login" },
  signUp: { title: "Start free", href: "/signup" },
};

export const footerColumns: NavGroup[] = [
  {
    label: "Product",
    items: [
      { title: "How it works", href: "/#how-it-works" },
      { title: "Alerts", href: "/#alerts" },
      { title: "Pricing", href: "/#pricing" },
      { title: "FAQ", href: "/#faq" },
    ],
  },
  { label: "Redlance for", items: productMenu.side[0].items },
  {
    label: "Guides",
    items: [
      {
        title: "Best subreddits for freelancers",
        href: "/best-subreddits-for-freelancers",
      },
    ],
  },
  {
    label: "Account",
    items: [authLinks.logIn, authLinks.signUp],
  },
];

export const legalLinks: NavItem[] = [
  { title: "Privacy", href: "/privacy" },
  { title: "Terms", href: "/terms" },
];
