import { describe, expect, it } from "vitest";
import { setBounded } from "./bounded-map";

describe("setBounded", () => {
  it("evicts the oldest entries above the cap", () => {
    const m = new Map<string, number>();
    for (const k of ["a", "b", "c", "d"]) setBounded(m, k, 1, 3);
    expect([...m.keys()]).toEqual(["b", "c", "d"]);
  });

  it("setting a key again makes it the newest", () => {
    const m = new Map<string, number>();
    for (const k of ["a", "b", "c"]) setBounded(m, k, 1, 3);
    setBounded(m, "a", 2, 3);
    setBounded(m, "d", 1, 3);
    expect([...m.entries()]).toEqual([
      ["c", 1],
      ["a", 2],
      ["d", 1],
    ]);
  });

  it("never evicts protected entries or the one just set", () => {
    const m = new Map<string, number>();
    for (const k of ["a", "b", "c"]) setBounded(m, k, 1, 3);
    // "a" and "b" are protected: "c" goes instead.
    setBounded(m, "d", 1, 3, (k) => k === "a" || k === "b");
    expect([...m.keys()]).toEqual(["a", "b", "d"]);
    // Everything protected: the map grows past the cap rather than lose them.
    setBounded(m, "e", 1, 3, () => true);
    expect([...m.keys()]).toEqual(["a", "b", "d", "e"]);
  });
});
