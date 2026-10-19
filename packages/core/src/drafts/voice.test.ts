import { describe, expect, it } from "vitest";
import {
  measureSend,
  pickBestSends,
  shouldUpdateVoice,
  statsToTargets,
  updateStats,
} from "./voice";
import type { VoiceStats } from "./types";

const stats = (over: Partial<VoiceStats> = {}): VoiceStats => ({
  n: 5,
  avgWords: 48,
  avgWordsPerSentence: 9,
  greetingRate: 0.5,
  signOffRate: 0.5,
  emojiRate: 0.5,
  avgExclamations: 1,
  lowercaseStartRate: 0.5,
  linkRate: 0,
  avgLinkPosition: 0,
  mentionsRateRate: 0,
  avgEditRatio: 0.2,
  ...over,
});

const base = {
  sendsCounted: 4,
  sendsSinceUpdate: 1,
  recentOptions: [],
  updatesToday: 0,
};
const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

describe("measureSend", () => {
  it("1. reads a casual greeting", () => {
    const m = measureSend(
      "hey! saw your post about the shop. Happy to help.",
      "Hello, I saw your post.",
    );
    expect(m.greeting).toBe(true);
    expect(m.exclamations).toBe(1);
    expect(m.lowercaseStart).toBe(true);
    expect(m.emoji).toBe(false);
    expect(m.hasLink).toBe(false);
    expect(m.editRatio).toBeGreaterThan(0);
  });

  it("finds links, their position, sign-offs, emoji and rate mentions", () => {
    const m = measureSend(
      "I built this. See https://github.com/a/b\nThanks 🙂 my rate is $40/hr",
      "x",
    );
    expect(m.hasLink).toBe(true);
    expect(m.linkPosition).toBeGreaterThan(0);
    expect(m.linkPosition).toBeLessThan(1);
    expect(m.emoji).toBe(true);
    expect(m.mentionsRate).toBe(true);
  });
});

describe("updateStats", () => {
  it("2. keeps a running average of words", () => {
    const s = updateStats(stats({ n: 4, avgWords: 52 }), {
      ...measureSend(words(40), "x"),
    });
    expect(s.avgWords).toBeCloseTo(49.6);
    expect(s.n).toBe(5);
  });

  it("3. stores true/false values as rates", () => {
    let s = updateStats(null, measureSend("Hi there, saw your post", "x"));
    for (let i = 0; i < 3; i++)
      s = updateStats(s, measureSend("Saw your post", "x"));
    expect(s.n).toBe(4);
    expect(s.greetingRate).toBeCloseTo(0.25);
  });

  it("averages the link position over sends with a link only", () => {
    let s = updateStats(null, measureSend("no link here", "x"));
    s = updateStats(s, measureSend("https://github.com/a/b is my work", "x"));
    expect(s.linkRate).toBeCloseTo(0.5);
    expect(s.avgLinkPosition).toBeCloseTo(0);
  });
});

describe("statsToTargets", () => {
  it("4. is empty before 3 sends", () => {
    expect(statsToTargets(stats({ n: 2, greetingRate: 0 }))).toEqual([]);
  });

  it("5. says no greeting when the rate is low", () => {
    expect(statsToTargets(stats({ greetingRate: 0.1 }))).toContain(
      "No greeting line.",
    );
    expect(statsToTargets(stats())).toContain("Aim for about 48 words.");
  });

  it("puts the link where the user puts it", () => {
    expect(
      statsToTargets(stats({ linkRate: 0.8, avgLinkPosition: 0.95 })),
    ).toContain("Put the link at the end.");
  });
});

describe("shouldUpdateVoice", () => {
  it("6. fires on the 3rd send", () => {
    expect(
      shouldUpdateVoice({ ...base, sendsCounted: 3, sendsSinceUpdate: 3 }),
    ).toBe(true);
  });
  it("7. not on the 4th", () => {
    expect(shouldUpdateVoice(base)).toBe(false);
  });
  it("8. fires 5 sends after an update", () => {
    expect(
      shouldUpdateVoice({ ...base, sendsCounted: 8, sendsSinceUpdate: 5 }),
    ).toBe(true);
  });
  it("9. fires when the same rewrite option is picked 3 times", () => {
    expect(
      shouldUpdateVoice({
        ...base,
        recentOptions: ["shorter", "shorter", "shorter"],
      }),
    ).toBe(true);
    expect(
      shouldUpdateVoice({
        ...base,
        recentOptions: ["shorter", "warmer", "shorter"],
      }),
    ).toBe(false);
  });
  it("10. never past the daily cap", () => {
    expect(
      shouldUpdateVoice({
        sendsCounted: 3,
        sendsSinceUpdate: 9,
        recentOptions: ["a", "a", "a"],
        updatesToday: 2,
      }),
    ).toBe(false);
  });
});

describe("pickBestSends", () => {
  const r = (id: string, editRatio: number, status: string, n = 30) => ({
    id,
    editRatio,
    status,
    text: words(n),
  });
  it("11. lowest edit ratio first, replied wins ties, short sends skipped", () => {
    const ids = pickBestSends([
      r("a", 0.3, "sent"),
      r("b", 0.1, "sent", 10),
      r("c", 0.3, "replied"),
      r("d", 0.5, "hired"),
    ]);
    expect(ids).toEqual(["c", "a"]);
    expect(pickBestSends([r("x", 0, "sent", 19)])).toEqual([]);
    expect(pickBestSends([r("h", 0.2, "sent"), r("i", 0.2, "hired")])[0]).toBe(
      "i",
    );
  });
});
