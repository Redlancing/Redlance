import type {
  EntrySource,
  ProjectKind,
  ProjectRole,
  RoleEmploymentType,
} from "@redlance/core";

/**
 * The 5 synthetic profiles the draft eval cases point at. Everything here is invented: names,
 * organisations, links and GitHub usernames do not belong to real people or companies.
 *
 * The shape is what the drafter loads for a user: the profile row, the core/secondary skills,
 * and the projects and roles (hidden ones included, so `buildEvidence` has to leave them out).
 */

export type EvalSkill = { skillId: string; level: "core" | "secondary" };

export type EvalProject = {
  id: string;
  position: number;
  title: string;
  summary: string;
  skillIds: string[];
  categories: string[];
  domains: string[];
  role: ProjectRole;
  kind: ProjectKind;
  outcomes: string[];
  links: string[];
  year: number | null;
  source: EntrySource;
  hidden: boolean;
};

export type EvalRole = {
  id: string;
  position: number;
  title: string;
  summary: string;
  skillIds: string[];
  categories: string[];
  domains: string[];
  organisation: string | null;
  organisationDescription: string;
  employmentType: RoleEmploymentType;
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  isCurrent: boolean;
  highlights: string[];
  source: EntrySource;
  hidden: boolean;
};

export type EvalProfile = {
  id: string;
  /** What this profile is for, for people reading the cases. */
  note: string;
  displayName: string;
  headline: string;
  categories: string[];
  experienceLevel: "beginner" | "intermediate" | "experienced";
  country: string;
  timeZone: string;
  githubUsername: string | null;
  /** Minor units (cents / pence / paise). */
  minRateMinor: number;
  currency: "USD" | "GBP" | "EUR" | "INR";
  rateType: "hourly" | "fixed" | "either";
  remoteOnly: boolean;
  mentionEmployers: boolean;
  includeUnpaid: boolean;
  skills: EvalSkill[];
  projects: EvalProject[];
  experience: EvalRole[];
};

const project = (
  p: Partial<EvalProject> &
    Pick<EvalProject, "id" | "position" | "title" | "summary" | "skillIds">,
): EvalProject => ({
  categories: [],
  domains: [],
  role: "solo",
  kind: "client",
  outcomes: [],
  links: [],
  year: null,
  source: "manual",
  hidden: false,
  ...p,
});

const role = (
  r: Partial<EvalRole> &
    Pick<
      EvalRole,
      "id" | "position" | "title" | "summary" | "employmentType" | "skillIds"
    >,
): EvalRole => ({
  categories: [],
  domains: [],
  organisation: null,
  organisationDescription: "",
  startYear: null,
  startMonth: null,
  endYear: null,
  endMonth: null,
  isCurrent: false,
  highlights: [],
  source: "manual",
  hidden: false,
  ...r,
});

export const PROFILES: EvalProfile[] = [
  {
    id: "web-dev",
    note: "Mid-level web developer: React, Node, Stripe; 4 projects, GitHub.",
    displayName: "Maya Okafor",
    headline: "Full-stack developer for small SaaS teams",
    categories: ["development"],
    experienceLevel: "intermediate",
    country: "GB",
    timeZone: "Europe/London",
    githubUsername: "maya-okafor-dev",
    minRateMinor: 4000,
    currency: "USD",
    rateType: "hourly",
    remoteOnly: true,
    mentionEmployers: true,
    includeUnpaid: false,
    skills: [
      { skillId: "react", level: "core" },
      { skillId: "nextjs", level: "core" },
      { skillId: "nodejs", level: "core" },
      { skillId: "typescript", level: "core" },
      { skillId: "payments", level: "core" },
      { skillId: "postgresql", level: "secondary" },
      { skillId: "sql", level: "secondary" },
      { skillId: "tailwind", level: "secondary" },
      { skillId: "python", level: "secondary" },
    ],
    projects: [
      project({
        id: "web-dev-p1",
        position: 0,
        title: "Subscription billing portal",
        summary:
          "Self-serve plan changes, invoices and failed-payment retries for a B2B SaaS.",
        skillIds: ["payments", "react", "nodejs", "postgresql"],
        categories: ["development"],
        domains: ["saas", "fintech"],
        kind: "client",
        outcomes: ["Cut billing support emails by about 40%"],
        links: ["https://github.com/maya-okafor-dev/billing-portal"],
        year: 2024,
      }),
      project({
        id: "web-dev-p2",
        position: 1,
        title: "Ops dashboard for a logistics start-up",
        summary:
          "React dashboard over a REST API: live order table, filters, CSV export.",
        skillIds: ["react", "typescript", "nodejs", "tailwind"],
        categories: ["development"],
        domains: ["logistics"],
        role: "lead",
        kind: "client",
        outcomes: ["Dispatchers stopped using spreadsheets within a month"],
        links: ["https://ops-dashboard-demo.example.dev"],
        year: 2023,
      }),
      project({
        id: "web-dev-p3",
        position: 2,
        title: "Meal planner for families",
        summary: "Next.js app that builds a weekly menu and shopping list.",
        skillIds: ["nextjs", "typescript", "postgresql"],
        categories: ["development"],
        domains: ["food"],
        kind: "personal",
        links: ["https://github.com/maya-okafor-dev/meal-planner"],
        year: 2022,
      }),
      project({
        id: "web-dev-p4",
        position: 3,
        title: "Shopify order sync script",
        summary:
          "Node script that syncs orders to a stock spreadsheet nightly.",
        skillIds: ["nodejs", "rest-api", "automation"],
        categories: ["development"],
        domains: ["retail"],
        kind: "client",
        year: 2022,
        hidden: true,
      }),
    ],
    experience: [
      role({
        id: "web-dev-r1",
        position: 0,
        title: "Software developer",
        summary: "Product engineer on a payments team.",
        employmentType: "full_time",
        skillIds: ["react", "nodejs", "payments"],
        organisation: "Brightwell Payments",
        organisationDescription: "a UK payments start-up",
        startYear: 2021,
        endYear: 2024,
        highlights: ["Built the merchant onboarding flow in React"],
      }),
      role({
        id: "web-dev-r2",
        position: 1,
        title: "Freelance web developer",
        summary: "Small-business sites and web apps.",
        employmentType: "freelance",
        skillIds: ["react", "nextjs", "nodejs"],
        organisationDescription: "independent",
        startYear: 2024,
        isCurrent: true,
        highlights: ["Ten client projects shipped, mostly repeat clients"],
      }),
    ],
  },
  {
    id: "video-editor",
    note: "Video editor: Premiere, After Effects, YouTube shorts; 2 projects, no GitHub.",
    displayName: "Dev Kapoor",
    headline: "YouTube and short-form video editor",
    categories: ["video"],
    experienceLevel: "intermediate",
    country: "IN",
    timeZone: "Asia/Kolkata",
    githubUsername: null,
    minRateMinor: 2500,
    currency: "USD",
    rateType: "either",
    remoteOnly: true,
    mentionEmployers: false,
    includeUnpaid: false,
    skills: [
      { skillId: "premiere-pro", level: "core" },
      { skillId: "after-effects", level: "core" },
      { skillId: "short-form-video", level: "core" },
      { skillId: "youtube-editing", level: "core" },
      { skillId: "motion-graphics", level: "secondary" },
      { skillId: "subtitles", level: "secondary" },
      { skillId: "color-grading", level: "secondary" },
      { skillId: "podcast-editing", level: "secondary" },
      { skillId: "audio-editing", level: "secondary" },
    ],
    projects: [
      project({
        id: "video-editor-p1",
        position: 0,
        title: "Weekly tech-review channel",
        summary:
          "Edited 12-minute videos with b-roll, captions and a recurring intro.",
        skillIds: ["youtube-editing", "premiere-pro", "subtitles"],
        categories: ["video"],
        domains: ["media"],
        kind: "client",
        outcomes: ["Turnaround cut from 5 days to 2"],
        links: ["https://vimeo.com/redlance-eval/techreview-reel"],
        year: 2024,
      }),
      project({
        id: "video-editor-p2",
        position: 1,
        title: "Podcast clips for a fitness show",
        summary: "Vertical clips with animated captions, three a week.",
        skillIds: ["short-form-video", "after-effects", "podcast-editing"],
        categories: ["video"],
        domains: ["fitness"],
        kind: "client",
        outcomes: ["Clips averaged 3x the channel's usual views"],
        links: ["https://vimeo.com/redlance-eval/clips-reel"],
        year: 2025,
      }),
    ],
    experience: [],
  },
  {
    id: "junior-designer",
    note: "Junior designer: one college project, no work history.",
    displayName: "Priya Nair",
    headline: "Graphic designer, recent graduate",
    categories: ["design", "art"],
    experienceLevel: "beginner",
    country: "IN",
    timeZone: "Asia/Kolkata",
    githubUsername: null,
    minRateMinor: 1500,
    currency: "USD",
    rateType: "either",
    remoteOnly: true,
    mentionEmployers: false,
    includeUnpaid: false,
    skills: [
      { skillId: "logo-design", level: "core" },
      { skillId: "graphic-design", level: "core" },
      { skillId: "figma", level: "core" },
      { skillId: "illustrator", level: "secondary" },
      { skillId: "canva", level: "secondary" },
      { skillId: "illustration", level: "secondary" },
      { skillId: "digital-art", level: "secondary" },
    ],
    projects: [
      project({
        id: "junior-designer-p1",
        position: 0,
        title: "Brand identity for a campus cafe",
        summary:
          "Logo, colour palette and menu layout for a final-year design brief.",
        skillIds: ["logo-design", "illustrator", "graphic-design"],
        categories: ["design"],
        domains: ["food"],
        kind: "academic",
        links: ["https://www.behance.net/priyanair-eval/campus-cafe"],
        year: 2025,
      }),
    ],
    experience: [],
  },
  {
    id: "senior-writer",
    note: "Senior writer with named employers; mentionEmployers is off.",
    displayName: "Tom Hargreaves",
    headline: "B2B and technical writer",
    categories: ["writing"],
    experienceLevel: "experienced",
    country: "US",
    timeZone: "America/Chicago",
    githubUsername: null,
    minRateMinor: 6000,
    currency: "USD",
    rateType: "either",
    remoteOnly: true,
    mentionEmployers: false,
    includeUnpaid: false,
    skills: [
      { skillId: "copywriting", level: "core" },
      { skillId: "technical-writing", level: "core" },
      { skillId: "seo-writing", level: "core" },
      { skillId: "ghostwriting", level: "secondary" },
      { skillId: "newsletter-writing", level: "secondary" },
      { skillId: "editing-proofreading", level: "secondary" },
      { skillId: "content-marketing", level: "secondary" },
    ],
    projects: [
      project({
        id: "senior-writer-p1",
        position: 0,
        title: "API documentation rewrite",
        summary: "Rebuilt the docs for a developer-tools product from scratch.",
        skillIds: ["technical-writing"],
        categories: ["writing"],
        domains: ["saas"],
        kind: "employer",
        outcomes: ["Support tickets about setup fell by a third"],
        links: ["https://docs-sample.example.com/tom-hargreaves"],
        year: 2023,
      }),
      project({
        id: "senior-writer-p2",
        position: 1,
        title: "Thought-leadership ghostwriting for founders",
        summary: "Monthly LinkedIn essays for two SaaS founders.",
        skillIds: ["ghostwriting", "copywriting"],
        categories: ["writing"],
        domains: ["saas"],
        kind: "client",
        outcomes: ["One essay passed 200k impressions"],
        year: 2024,
      }),
    ],
    experience: [
      role({
        id: "senior-writer-r1",
        position: 0,
        title: "Senior content writer",
        summary: "Led the blog and the help centre.",
        employmentType: "full_time",
        skillIds: ["seo-writing", "technical-writing", "copywriting"],
        organisation: "Northfield Software",
        organisationDescription: "a mid-size B2B software company",
        startYear: 2018,
        endYear: 2023,
        highlights: [
          "Grew organic blog traffic from 20k to 90k visits a month",
          "Managed three freelance writers",
        ],
      }),
      role({
        id: "senior-writer-r2",
        position: 1,
        title: "Technical writer",
        summary: "Wrote product documentation and release notes.",
        employmentType: "full_time",
        skillIds: ["technical-writing"],
        organisation: "Calder & Finch",
        organisationDescription: "a developer-tools company",
        startYear: 2014,
        endYear: 2018,
      }),
      role({
        id: "senior-writer-r3",
        position: 2,
        title: "Freelance writer",
        summary: "Long-form and case studies for B2B brands.",
        employmentType: "freelance",
        skillIds: ["copywriting", "ghostwriting"],
        organisationDescription: "independent",
        startYear: 2023,
        isCurrent: true,
      }),
    ],
  },
  {
    id: "broad-generalist",
    note: "Broad-match profile: picked job types, only one skill, little to cite.",
    displayName: "Sam Whitlock",
    headline: "Marketing and admin support",
    categories: ["marketing", "admin", "data"],
    experienceLevel: "intermediate",
    country: "US",
    timeZone: "America/New_York",
    githubUsername: null,
    minRateMinor: 1800,
    currency: "USD",
    rateType: "hourly",
    remoteOnly: true,
    mentionEmployers: false,
    includeUnpaid: false,
    skills: [{ skillId: "excel", level: "secondary" }],
    projects: [],
    experience: [
      role({
        id: "broad-generalist-r1",
        position: 0,
        title: "Operations assistant",
        summary:
          "Day-to-day admin, scheduling and reporting for a small agency.",
        employmentType: "part_time",
        skillIds: ["excel", "virtual-assistant"],
        organisationDescription: "a small marketing agency",
        organisation: "Larkspur Studio",
        startYear: 2022,
        endYear: 2025,
      }),
    ],
  },
];

export const PROFILE_BY_ID: ReadonlyMap<string, EvalProfile> = new Map(
  PROFILES.map((p) => [p.id, p]),
);
