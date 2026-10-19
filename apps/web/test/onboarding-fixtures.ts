export const VALID = {
  import: { githubUsername: "asha-edits" },
  basics: {
    displayName: "Asha",
    headline: "Video editor",
    categories: ["video"],
    experienceLevel: "intermediate",
    country: "IN",
    timeZone: "Asia/Kolkata",
  },
  skills: {
    skills: [
      { id: "video-editing", level: "core" },
      { id: "premiere-pro", level: "secondary" },
    ],
    customSkills: [{ name: "Descript", level: "secondary" }],
  },
  work: {
    projects: [
      {
        title: "Wedding film",
        summary: "Edited a 10-minute wedding film.",
        role: "solo",
        kind: "client",
        skills: ["video-editing"],
        outcomes: ["Delivered in 3 days"],
        links: ["https://vimeo.com/123"],
        year: 2024,
        source: "resume",
      },
      {
        title: "Channel trailer",
        summary: "A 30-second trailer for my channel.",
        kind: "personal",
        hidden: true,
      },
    ],
    experience: [
      {
        title: "Video editor",
        organisation: "Acme Media",
        organisationDescription: "a YouTube production studio",
        employmentType: "full_time",
        start: { year: 2021, month: 3 },
        current: true,
        highlights: ["Cut 40 videos a month"],
        source: "resume",
      },
    ],
    mentionEmployers: true,
  },
  rates: {
    minRate: 25,
    currency: "USD",
    rateType: "hourly",
    remoteOnly: true,
  },
} as const;
