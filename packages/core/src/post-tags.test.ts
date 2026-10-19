import { describe, expect, it } from "vitest";
import { preKindFromTitle } from "./post-tags";

// Titles are real ones seen during the 2026-09-30 subreddit study.
describe("preKindFromTitle", () => {
  it.each([
    "[HIRING] 30s First-Person Animated Intro (2D/3D Urban Fantasy)",
    "[Hiring] 2D Motion Designer for YouTube Shorts ($20 - $35 / video)",
    "[task] Video Editor / AI Video Generation",
    "[PAID] Looking for gacha-inspired 2D art for my gacha game parody",
    "[PAID – $20-60/hr] Voice actors wanted for AI training-data",
    "🎬 [HIRING / COLLAB] Looking for Beginner & Intermediate Short-Form Vid",
    "HIRING: Short-Form Video Editor",
    "🎬 HIRING: Short-Form Video Editor",
    "Hiring video editors with a very good portfolio",
    "We're hiring a Shopify developer",
    "URGENT HIRING 2D Animator, On-site Chandigarh",
    "[Hiring][Design] 4 Remote Jobs for Virtual Assistants",
    "PAID - 2D Art | Animation for a platformer",
    "[BUYING] Emotes for my Twitch channel",
    "[LFC] Looking for a character ref sheet",
    "[Seeking Artist] Cover for my novel",
  ])("hiring: %s", (title) => {
    expect(preKindFromTitle(title)).toBe("hiring");
  });

  it.each([
    "[for hire] Affordable commissions open! Details in comments",
    "[FOR HIRE] Operations Associate | Lead Generation | Research",
    "{For Hire} Gaming Video Editor",
    "[Hire Me] Fiction writer",
    "[OFFER] I will proofread your essay",
    "For hire: full-stack developer",
    "Commissions open! Chibi drawings $15",
    "[Artist] Anime portraits, 3 slots left",
    "[FOR HIRE] Sound designer — I'm hiring my time out",
    "[Seeking Work] Video editor, 3 years",
    "My commissions are now open!",
  ])("for hire: %s", (title) => {
    expect(preKindFromTitle(title)).toBe("for_hire");
  });

  it.each([
    "Need a video editor? I promise I won't make your footage look bad",
    "Looking for someone to remove the background of pictures of my face",
    "Please restore my mom and grandparents",
    "What's everyone paid per hour?",
    "Is hiring slow for anyone else?",
    "Anyone with commissions open? Need a pet portrait",
  ])("unknown: %s", (title) => {
    expect(preKindFromTitle(title)).toBe("unknown");
  });
});
