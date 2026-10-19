import { describe, expect, it } from "vitest";
import {
  isStale,
  serverStepVersion,
  type ServerOnboarding,
} from "./stale-step";

const server: ServerOnboarding = {
  steps: [
    { id: "import", status: "completed", version: 1 },
    { id: "basics", status: "completed", version: 2 },
  ],
  resumeAt: "skills",
};

describe("isStale", () => {
  it("is fresh when this step and resumeAt match the server", () => {
    expect(
      isStale(
        { step: "basics", version: 2, status: "completed", resumeAt: "skills" },
        server,
      ),
    ).toBe(false);
    expect(
      isStale(
        { step: "skills", version: 0, status: null, resumeAt: "skills" },
        server,
      ),
    ).toBe(false);
  });
  it("is stale when the step's version or status moved on", () => {
    expect(
      isStale(
        { step: "basics", version: 0, status: null, resumeAt: "basics" },
        server,
      ),
    ).toBe(true);
    expect(
      isStale(
        { step: "basics", version: 2, status: "draft", resumeAt: "skills" },
        server,
      ),
    ).toBe(true);
  });
  it("is stale when only resumeAt moved on", () => {
    expect(
      isStale(
        { step: "import", version: 1, status: "completed", resumeAt: "basics" },
        server,
      ),
    ).toBe(true);
  });
});

describe("serverStepVersion", () => {
  it("returns the step's server version, or 0 before its first save", () => {
    expect(serverStepVersion(server, "basics")).toBe(2);
    expect(serverStepVersion(server, "rates")).toBe(0);
  });
});
