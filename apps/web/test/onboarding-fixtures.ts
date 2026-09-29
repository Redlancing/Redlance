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
  rates: {
    minRate: 25,
    currency: "USD",
    rateType: "hourly",
    remoteOnly: true,
    blockedWords: ["unpaid"],
  },
} as const;
