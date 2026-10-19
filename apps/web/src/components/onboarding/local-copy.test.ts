import { describe, expect, it } from "vitest";
import { parseLocalCopy } from "./local-copy";

const init = {
  step: "basics" as const,
  version: 2,
  data: { displayName: "Asha" },
};
const copy = (version: number, data: unknown) =>
  JSON.stringify({ version, data });

describe("parseLocalCopy", () => {
  it("offers a copy made from the same server version that differs from it", () => {
    expect(
      parseLocalCopy(copy(2, { displayName: "Asha K" }), init)?.displayName,
    ).toBe("Asha K");
  });

  it("ignores copies from another version, identical copies, invalid data and junk", () => {
    expect(parseLocalCopy(copy(1, { displayName: "Old" }), init)).toBeNull();
    expect(
      parseLocalCopy(copy(2, { displayName: "Asha" }), {
        ...init,
        data: { ...init.data },
      }),
    ).toBeNull();
    expect(parseLocalCopy(copy(2, { displayName: 5 }), init)).toBeNull();
    expect(parseLocalCopy("{not json", init)).toBeNull();
    expect(parseLocalCopy(null, init)).toBeNull();
  });
});
