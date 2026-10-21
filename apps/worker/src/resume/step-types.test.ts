import { WORK_LIMITS } from "@redlance/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildPipelineInput, CALLS } from "./pipeline";
import {
  basicsOutput,
  safetyMax,
  skillsOutput,
  workSchemaFor,
} from "./step-types";

/**
 * Vertex answers 400 INVALID_ARGUMENT ("Request contains an invalid argument") when a
 * top-level entry list has `maxItems` and its items hold lists with their own `maxItems`
 * (found 2026-10-21: every projects and experience call failed instantly). Bisected live:
 * dropping only the outer `maxItems` works, and so does keeping it with no nested ones. It
 * isn't plain nesting (a small 3-level test schema passed, and outcomes ≤ 3 holding
 * clientNames ≤ 4 is accepted under an uncapped list), so it looks like a limit on how far
 * Vertex expands bounded repeats; the capped outer list multiplies everything inside it.
 * So the outer lists have no `maxItems`, and merge.ts enforces their limits instead.
 * Returns the paths of capped lists found inside a capped top-level list.
 */
function cappedInsideCappedTop(schema: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o.type === "array" && typeof o.maxItems === "number") found.push(path);
    for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
  };
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  for (const [key, top] of Object.entries(props ?? {})) {
    const t = top as Record<string, unknown>;
    if (t.type === "array" && typeof t.maxItems === "number")
      walk(t.items, `$.properties.${key}.items`);
  }
  return found;
}

const RESUME = [
  "Jane Doe",
  "Full-stack developer",
  "Experience",
  "Senior Developer, Acme Corp  Jan 2020 - Present",
  "• Built a React and Node dashboard",
  "Developer, Beta Ltd  2018 - 2019",
  "• Wrote Python scripts",
  "Projects",
  "Shopfront",
  "• A Next.js store with Stripe",
  "Chat app",
  "• A TypeScript chat app",
  "Skills",
  "React, Node.js, Python, TypeScript",
].join("\n");

const jsonOf = (s: z.ZodType) => z.toJSONSchema(s);

describe("schemas sent to Vertex", () => {
  it("the realistic input has project and experience lines", () => {
    const input = buildPipelineInput(RESUME);
    expect(input.projectLines?.lines.length).toBeGreaterThan(0);
    expect(input.experienceLines?.lines.length).toBeGreaterThan(0);
  });

  it("no call's schema has a capped top-level list holding capped lists", () => {
    const input = buildPipelineInput(RESUME);
    for (const call of CALLS) {
      const schema = (
        "schemaFor" in call && call.schemaFor
          ? call.schemaFor(input)
          : (call as { schema: z.ZodType }).schema
      ) as z.ZodType;
      expect(cappedInsideCappedTop(jsonOf(schema)), call.name).toEqual([]);
    }
  });

  it("the guard catches the shape Vertex rejects", () => {
    const bad = z.object({
      list: z.array(z.object({ tags: z.array(z.string()).max(2) })).max(8),
    });
    expect(cappedInsideCappedTop(jsonOf(bad))).toEqual([
      "$.properties.list.items.properties.tags",
    ]);
  });

  it("the work schema keeps the nested limits and accepts too many entries (merge cuts them)", () => {
    const schema = workSchemaFor(4, 3, ["react"]);
    const json = JSON.stringify(jsonOf(schema));
    expect(json).toContain(`"maxItems":${WORK_LIMITS.entrySkills}`);
    const project = {
      lines: { from: 1, to: 2 },
      title: "T",
      summary: "S",
      role: "unknown",
      kind: "personal",
      skills: [],
      categories: [],
      domains: [],
      outcomes: [],
      clientNames: [],
    };
    const r = schema.safeParse({
      projects: Array.from({ length: WORK_LIMITS.projects + 2 }, () => project),
      experience: [],
    });
    expect(r.success).toBe(true);
  });

  it("sends line-number bounds as a hint, but a number past them never fails the call", () => {
    const schema = workSchemaFor(4, 3, []);
    const json = jsonOf(schema) as unknown as {
      properties: Record<
        string,
        { items: { properties: { lines: { properties: unknown } } } }
      >;
    };
    expect(json.properties.projects!.items.properties.lines.properties).toEqual(
      {
        from: { type: "integer", minimum: 1, maximum: 4 },
        to: { type: "integer", minimum: 1, maximum: 4 },
      },
    );
    expect(
      json.properties.experience!.items.properties.lines.properties,
    ).toMatchObject({ to: { maximum: 3 } });
    const project = (lines: unknown) => ({
      lines,
      title: "T",
      summary: "S",
      role: "unknown",
      kind: "personal",
      skills: [],
      categories: [],
      domains: [],
      outcomes: [],
      clientNames: [],
    });
    const parse = (lines: unknown) =>
      schema.safeParse({ projects: [project(lines)], experience: [] }).success;
    expect(parse({ from: 0, to: 40 })).toBe(true);
    expect(parse({ from: 3, to: 1 })).toBe(true);
    expect(parse({ from: 1.5, to: 2 })).toBe(false);
    expect(parse({ from: 1 })).toBe(false);
    // No list when its section has no lines.
    expect(Object.keys(jsonOf(workSchemaFor(0, 3, [])).properties!)).toEqual([
      "experience",
    ]);
  });

  it("accepts a string over its real limit but rejects runaway output", () => {
    const schema = workSchemaFor(4, 0, []);
    const project = (title: string) => ({
      lines: { from: 1, to: 2 },
      title,
      summary: "S",
      role: "unknown",
      kind: "personal",
      skills: [],
      categories: [],
      domains: [],
      outcomes: [],
      clientNames: [],
    });
    const ok = schema.safeParse({
      projects: [project("x".repeat(WORK_LIMITS.entryTitle + 8))],
    });
    expect(ok.success).toBe(true);
    const bad = schema.safeParse({
      projects: [project("x".repeat(safetyMax(WORK_LIMITS.entryTitle) + 1))],
    });
    expect(bad.success).toBe(false);
    const basics = { headline: "h".repeat(200), country: null };
    expect(
      basicsOutput.safeParse({ ...basics, displayName: "n".repeat(100) })
        .success,
    ).toBe(true);
    expect(
      basicsOutput.safeParse({ ...basics, displayName: "n".repeat(400) })
        .success,
    ).toBe(false);
    expect(
      skillsOutput.safeParse({
        skills: [{ id: "react", level: "core", evidence: "e".repeat(250) }],
      }).success,
    ).toBe(true);
  });
});
