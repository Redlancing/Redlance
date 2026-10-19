import { describe, expect, it } from "vitest";
import { errorMessageFor } from "./form-errors";

const errors = [
  { path: "skills.3.id", message: "Unknown skill." },
  { path: "displayName", message: "Add your name." },
  { path: "customSkills.0.name", message: "Too long." },
];

describe("errorMessageFor", () => {
  it("matches the exact path", () => {
    expect(errorMessageFor(errors, "displayName")).toBe("Add your name.");
  });
  it("matches errors inside a field (list items and their parts)", () => {
    expect(errorMessageFor(errors, "skills")).toBe("Unknown skill.");
    expect(errorMessageFor(errors, "customSkills")).toBe("Too long.");
  });
  it("does not match fields that only share a prefix", () => {
    expect(errorMessageFor(errors, "skill")).toBeUndefined();
    expect(errorMessageFor(errors, "display")).toBeUndefined();
  });
});
