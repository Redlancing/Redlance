# Onboarding, Slice 1 (Manual Onboarding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user walks through Import (an optional GitHub link; resume upload comes in slice 2) → Basics → Skills → Rates & filters → Review, saving each step with **Next** or **Save draft**. They come back to the step where they left off, and **Finish** writes their profile, connects subreddits for their job types, turns on email alerts and starts the 5-day trial.

**Architecture:** Every rule about the steps (their order, per-step draft/complete zod schemas, `resumeAt()`, the skill taxonomy, the subreddit seed list) lives in a new pure package, `@redlance/core`, used by both the browser forms and the server. `@redlance/db` gets the onboarding and profile tables, plus `syncReferenceData()`, which copies the taxonomy and subreddits into Postgres after migrations. The web app has one service module (`server/onboarding/service.ts`) that is the only code writing these tables. Three thin `/api/v1/onboarding` routes call that service, and the pages under the new `(onboarding)` route group read state through it directly.

**Tech Stack:** Next.js 16 (App Router, React Compiler) · zod 4 · Drizzle ORM 0.45 + drizzle-kit 0.31 · Postgres 17 · uuid 14 (v7) · Vitest 5 · shadcn/ui on Base UI

**Spec:** `docs/onboarding/design.md` (this plan covers "Build order" slice 1; slices 2 and 3 get their own plans once this lands).

## Global Constraints

- Everything in the spec's "Global" rules for the codebase still applies (see `CLAUDE.md`): every route goes through `apiRoute()`; server-only modules start with `import "server-only";`; the schema changes only through committed drizzle-kit migrations; error bodies are `{ error: { code, message, requestId, details? } }`.
- `@redlance/core` is **pure**: no Node APIs, no I/O, safe to import from client components. Its only runtime dependencies are `zod` and `uuid`.
- `packages/db/src/schema.ts` must **not** import `@redlance/core` (drizzle-kit loads that file on its own). It keeps its own literal lists, and a db test checks they match core.
- New tables use UUIDv7 IDs (`uuid` package, `v7()`); `users` keeps random UUIDs.
- Every new table with a `user_id` references `users(id) ON DELETE CASCADE`.
- Step rules (spec, "Where the user lands"):
  - A save of step N (draft or complete) needs steps 1…N−1 completed, else 409 `STEP_ORDER`.
  - A completed step never goes back to draft (400).
  - After Finish, saves return 409 `ALREADY_ONBOARDED`.
  - A stale `expectedVersion` returns 409 `VERSION_CONFLICT`.
- Skills are never deleted from `taxonomy.ts`; they are flagged `retired: true`.
- No autosave to the server. `localStorage` holds unsaved form values only (per-viewer convenience), wrapped in try/catch.
- Commit messages have **no** Claude co-author trailer or "Generated with Claude Code" line (the user's standing rule for this repo).

## Review Focus

- **Step order bypass:** a crafted `PUT /onboarding/steps/rates` before Basics is completed must return 409 `STEP_ORDER`. Test: Task 7, "refuses a step after resumeAt".
- **Double Finish:** two concurrent `POST /onboarding/finish` calls produce one profile, and `trial_ends_at` never moves. Test: Task 7, "finish is idempotent under concurrency".
- **Two tabs:** saving with a stale version returns 409 and never overwrites. Test: Task 7, "version conflict".
- **Malformed step data** (unknown keys, wrong types, 10 000 skills, 1 MB body): 400 or 413, never 500. Tests: Task 3 schema tests, Task 5 "413 for a large body", Task 8 route tests.
- **Retired or unknown skills:** unknown skill IDs are refused. A skill retired *after* being saved still passes, and Finish can still insert it (FK). Test: Task 4, "sync never deletes".

---

## File map

| File | Responsibility |
|---|---|
| `packages/core/package.json`, `tsconfig.json`, `vitest.config.ts` | New package setup |
| `packages/core/src/ids.ts` | `newId()` → UUIDv7 |
| `packages/core/src/taxonomy.ts` | `CATEGORIES`, `SKILLS`, `SKILL_BY_ID`, `normalizeSkillName`, `findSkill`, `searchSkills` |
| `packages/core/src/subreddits.ts` | `SUBREDDITS` seed list, `subredditsFor(categories)` |
| `packages/core/src/countries.ts` | `COUNTRY_CODES`, `defaultCurrency(country)` |
| `packages/core/src/onboarding.ts` | Step IDs, limits, per-step draft/complete schemas, `resumeAt`, page helpers, `toFieldErrors`, `TRIAL_DAYS` |
| `packages/core/src/index.ts` | Public exports |
| `packages/core/src/*.test.ts` | Unit tests |
| `packages/db/src/schema.ts` | + `skills`, `subreddits`, `onboarding_steps`, `profiles`, `profile_skills`, `custom_skills`, `user_subreddits`, `alert_channels` |
| `packages/db/src/reference.ts` | `syncReferenceData(db)` |
| `packages/db/src/migrate.ts`, `migrate-cli.ts` | + `prepareDatabase(url)` = migrate + sync |
| `packages/db/migrations/0002_onboarding.sql` | Generated |
| `packages/db/src/onboarding.test.ts` | Constraint + sync tests |
| `apps/web/next.config.ts` | `transpilePackages` + `@redlance/core` |
| `apps/web/test/global-setup.ts` | `prepareDatabase` |
| `apps/web/src/server/errors.ts` | + `VERSION_CONFLICT`, `STEP_ORDER`, `ALREADY_ONBOARDED`, `PAYLOAD_TOO_LARGE` |
| `apps/web/src/server/http.ts` | + `readBody(request, limit)` |
| `apps/web/src/server/api-route.ts` | + `params` option, JSON body cap |
| `apps/web/src/server/onboarding/service.ts` | `getOnboardingState`, `saveStep`, `finishOnboarding` |
| `apps/web/src/server/onboarding/service.test.ts` | Service integration tests |
| `apps/web/src/app/api/v1/onboarding/route.ts` | `GET` state |
| `apps/web/src/app/api/v1/onboarding/steps/[step]/route.ts` | `PUT` save a step |
| `apps/web/src/app/api/v1/onboarding/finish/route.ts` | `POST` finish |
| `apps/web/src/app/api/v1/onboarding/onboarding.test.ts` | Route tests |
| `apps/web/src/proxy.ts` (+ test) | Matcher + `/onboarding/:path*` |
| `apps/web/src/app/(onboarding)/layout.tsx` | Focused chrome (logo, sign out) |
| `apps/web/src/app/(onboarding)/onboarding/page.tsx` | Redirect to `resumeAt` |
| `apps/web/src/app/(onboarding)/onboarding/[step]/page.tsx` | Guards + renders the step |
| `apps/web/src/server/onboarding/page-data.ts` (+ test) | `loadOnboardingPage`, `stepInit`, `savedDraft`, `reviewData` |
| `apps/web/src/server/onboarding/trial.ts` (+ test) | `trialDaysLeft` |
| `apps/web/src/components/onboarding/step-form-types.ts` | `StepFormInit` (type only) |
| `apps/web/src/components/onboarding/local-copy.ts` (+ test) | Local safety-net rules (pure) |
| `apps/web/src/components/onboarding/browser-intl.ts` | Browser time zone(s), client-only |
| `apps/web/test/onboarding-fixtures.ts` | Valid data for every step |
| `apps/web/src/components/onboarding/progress.tsx` | "Step N of 5" + step list |
| `apps/web/src/components/onboarding/use-step-form.ts` | Save/next/back, conflicts, `beforeunload`, local safety net |
| `apps/web/src/components/onboarding/step-actions.tsx` | Button row, notices, restore banner, leave dialog |
| `apps/web/src/components/onboarding/field.tsx` | Label + control + error text |
| `apps/web/src/components/onboarding/{import,basics,skills,rates}-step.tsx` | Step forms |
| `apps/web/src/components/onboarding/review-step.tsx` | Summary + Finish |
| `apps/web/src/app/(app)/dashboard/page.tsx` | Setup card links to onboarding; trial line after |

---

### Task 1: Commit the docs and create `@redlance/core`

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/ids.ts`, `packages/core/src/ids.test.ts`, `packages/core/src/index.ts`

**Interfaces:**
- Produces: `newId(): string` (UUIDv7) from `@redlance/core`.

- [ ] **Step 1: Commit the spec, this plan and the CLAUDE.md handover**

We're on `feat/onboarding` already.

```bash
git add CLAUDE.md docs/superpowers
git commit -m "Add the onboarding spec, the slice 1 plan and the updated handover"
```

- [ ] **Step 2: Create the package files**

`packages/core/package.json`:

```json
{
  "name": "@redlance/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

`packages/core/tsconfig.json`: same as `packages/db/tsconfig.json`, with `"lib": ["ES2023"]` added (`Intl.supportedValuesOf` is ES2022+).

`packages/core/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "node" } });
```

Install (from the repo root):

```bash
npm install zod@^4.6.5 uuid@^14 -w @redlance/core
npm install -D typescript@^5 vitest@^5.0.2 @types/node@^24 -w @redlance/core
```

- [ ] **Step 3: Write the failing test**

`packages/core/src/ids.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newId } from "./ids";

describe("newId", () => {
  it("returns a version 7 UUID", () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("sorts by creation time", () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });
});
```

Run: `npm test -w @redlance/core`
Expected: FAIL (`./ids` not found).

- [ ] **Step 4: Implement**

`packages/core/src/ids.ts`:

```ts
import { v7 } from "uuid";

/** Time-sortable UUIDv7 for new tables. Postgres 17 has no built-in uuidv7(). */
export function newId(): string {
  return v7();
}
```

`packages/core/src/index.ts`:

```ts
export * from "./ids";
```

Run: `npm test -w @redlance/core && npm run typecheck -w @redlance/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core package.json package-lock.json
git commit -m "Add @redlance/core with UUIDv7 ids"
```

---

### Task 2: Taxonomy, subreddit seed list and countries

**Files:**
- Create: `packages/core/src/taxonomy.ts`, `packages/core/src/subreddits.ts`, `packages/core/src/countries.ts`, `packages/core/src/taxonomy.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `CATEGORIES` (`{ id, name, hint }[]`), `CategoryId`, `CATEGORY_IDS`
  - `Skill = { id, name, category, aliases, githubLanguages?, githubTopics?, retired? }`, `SKILLS`, `SKILL_BY_ID: ReadonlyMap<string, Skill>`
  - `normalizeSkillName(s)`, `findSkill(name): Skill | undefined`, `searchSkills(query, { categories?, limit? }): Skill[]`, `skillsForCategories(categories, limit)`
  - `SUBREDDITS` (`{ name, categories }[]`), `subredditsFor(categories): string[]`
  - `COUNTRY_CODES`, `isCountryCode(c)`, `defaultCurrency(country)`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/taxonomy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, defaultCurrency } from "./countries";
import { SUBREDDITS, subredditsFor } from "./subreddits";
import {
  CATEGORY_IDS,
  SKILLS,
  findSkill,
  normalizeSkillName,
  searchSkills,
  skillsForCategories,
} from "./taxonomy";

describe("taxonomy integrity", () => {
  it("has unique, url-safe skill ids", () => {
    const ids = SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("puts every skill in a known category, and every category has skills", () => {
    for (const s of SKILLS) expect(CATEGORY_IDS).toContain(s.category);
    for (const c of CATEGORY_IDS)
      expect(SKILLS.some((s) => s.category === c)).toBe(true);
  });

  it("never lets an id, name or alias point at two skills", () => {
    const seen = new Map<string, string>();
    for (const s of SKILLS) {
      for (const label of [s.id, s.name, ...s.aliases]) {
        const key = normalizeSkillName(label);
        const owner = seen.get(key);
        expect(owner === undefined || owner === s.id, `${key}: ${owner} vs ${s.id}`).toBe(true);
        seen.set(key, s.id);
      }
    }
  });

  it("maps a GitHub language to at most one skill", () => {
    const langs = SKILLS.flatMap((s) => s.githubLanguages ?? []);
    expect(new Set(langs).size).toBe(langs.length);
  });
});

describe("findSkill / searchSkills", () => {
  it("finds by name, alias and id, ignoring case and spacing", () => {
    expect(findSkill("React.js")?.id).toBe("react");
    expect(findSkill("  premiere  ")?.id).toBe("premiere-pro");
    expect(findSkill("nextjs")?.id).toBe("nextjs");
    expect(findSkill("C#")?.id).toBe("csharp");
    expect(findSkill("underwater basket weaving")).toBeUndefined();
  });

  it("ranks exact, then prefix, then substring matches, preferring the user's job types", () => {
    const results = searchSkills("edit", { categories: ["video"] }).map((s) => s.id);
    expect(results[0]).toBe("video-editing");
    expect(results).toContain("editing-proofreading");
  });

  it("returns nothing for an empty query and skips retired skills", () => {
    expect(searchSkills("   ")).toEqual([]);
    expect(searchSkills("a", { limit: 500 }).every((s) => !s.retired)).toBe(true);
  });

  it("lists popular skills for chosen job types", () => {
    const skills = skillsForCategories(["writing"], 5);
    expect(skills).toHaveLength(5);
    expect(skills.every((s) => s.category === "writing")).toBe(true);
  });
});

describe("subreddits", () => {
  it("uses lowercase names without r/ and known categories", () => {
    for (const s of SUBREDDITS) {
      expect(s.name).toMatch(/^[a-z0-9_]{2,21}$/);
      for (const c of s.categories) expect(CATEGORY_IDS).toContain(c);
    }
    expect(new Set(SUBREDDITS.map((s) => s.name)).size).toBe(SUBREDDITS.length);
  });

  it("gives everyone the general boards plus the boards for their job types", () => {
    const names = subredditsFor(["video"]);
    expect(names).toContain("forhire");
    expect(names).toContain("videoeditingrequests");
    expect(names).not.toContain("hireawriter");
  });
});

describe("countries", () => {
  it("has all 249 ISO 3166-1 alpha-2 codes", () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(COUNTRY_CODES).toContain("IN");
  });

  it("picks a sensible default currency", () => {
    expect(defaultCurrency("IN")).toBe("INR");
    expect(defaultCurrency("GB")).toBe("GBP");
    expect(defaultCurrency("DE")).toBe("EUR");
    expect(defaultCurrency("US")).toBe("USD");
    expect(defaultCurrency(null)).toBe("USD");
  });
});
```

Run: `npm test -w @redlance/core`
Expected: FAIL (modules missing).

- [ ] **Step 2: Implement the taxonomy**

`packages/core/src/taxonomy.ts`. The skill list is a starting point for review; the tests enforce its integrity, not its contents. Contract-cheating skills (essay/academic writing) are deliberately left out.

```ts
export const CATEGORIES = [
  { id: "development", name: "Development", hint: "Websites, apps, bots, automation" },
  { id: "games", name: "Game development", hint: "Unity, Unreal, Godot, Roblox, mods" },
  { id: "design", name: "Design", hint: "Logos, brand, UI/UX, print" },
  { id: "art", name: "Art & illustration", hint: "Commissions, characters, comics, emotes" },
  { id: "3d", name: "3D & animation", hint: "Modeling, rigging, rendering, CAD" },
  { id: "video", name: "Video", hint: "Editing, motion graphics, thumbnails" },
  { id: "photo", name: "Photo editing", hint: "Retouching, restoration, compositing" },
  { id: "audio", name: "Audio & voice", hint: "Voice-over, music, mixing, podcasts" },
  { id: "writing", name: "Writing & translation", hint: "Copy, articles, editing, translation" },
  { id: "marketing", name: "Marketing", hint: "SEO, social media, ads, email" },
  { id: "data", name: "Data & AI", hint: "Analysis, spreadsheets, scraping, ML" },
  { id: "admin", name: "Admin & support", hint: "Virtual assistance, data entry, research" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];

export type Skill = {
  id: string;
  name: string;
  category: CategoryId;
  aliases: readonly string[];
  /** GitHub repo `language` values that imply this skill (slice 3). */
  githubLanguages?: readonly string[];
  /** GitHub repo topics that imply this skill (slice 3). */
  githubTopics?: readonly string[];
  /** Never delete a skill: retire it so saved profiles stay valid. */
  retired?: boolean;
};

type Def = [
  id: string,
  name: string,
  aliases?: string[],
  github?: { languages?: string[]; topics?: string[] },
];

function group(category: CategoryId, defs: Def[]): Skill[] {
  return defs.map(([id, name, aliases = [], github]) => ({
    id,
    name,
    category,
    aliases,
    ...(github?.languages ? { githubLanguages: github.languages } : {}),
    ...(github?.topics ? { githubTopics: github.topics } : {}),
  }));
}

// Order inside a group = "popular first" for skillsForCategories().
export const SKILLS: readonly Skill[] = [
  ...group("development", [
    ["javascript", "JavaScript", ["js", "es6"], { languages: ["JavaScript"], topics: ["javascript"] }],
    ["typescript", "TypeScript", ["ts"], { languages: ["TypeScript"], topics: ["typescript"] }],
    ["react", "React", ["react.js", "reactjs"], { topics: ["react", "reactjs"] }],
    ["nextjs", "Next.js", ["nextjs", "next js"], { topics: ["nextjs"] }],
    ["nodejs", "Node.js", ["node", "express", "nestjs"], { topics: ["nodejs", "express", "nestjs"] }],
    ["python", "Python", ["py"], { languages: ["Python"], topics: ["python"] }],
    ["html-css", "HTML & CSS", ["html", "css", "html5", "css3"], { languages: ["HTML", "CSS", "SCSS"] }],
    ["wordpress", "WordPress", ["wp", "woocommerce"], { topics: ["wordpress", "woocommerce"] }],
    ["shopify", "Shopify", ["liquid"], { languages: ["Liquid"], topics: ["shopify"] }],
    ["php", "PHP", [], { languages: ["PHP"] }],
    ["laravel", "Laravel", [], { topics: ["laravel"] }],
    ["django", "Django", [], { topics: ["django"] }],
    ["fastapi", "FastAPI", ["flask"], { topics: ["fastapi", "flask"] }],
    ["vue", "Vue", ["vue.js", "vuejs", "nuxt"], { languages: ["Vue"], topics: ["vue", "vuejs", "nuxt"] }],
    ["angular", "Angular", [], { topics: ["angular"] }],
    ["svelte", "Svelte", ["sveltekit"], { languages: ["Svelte"], topics: ["svelte", "sveltekit"] }],
    ["tailwind", "Tailwind CSS", ["tailwindcss"], { topics: ["tailwindcss"] }],
    ["react-native", "React Native", [], { topics: ["react-native"] }],
    ["flutter", "Flutter", [], { languages: ["Dart"], topics: ["flutter"] }],
    ["ios", "iOS development", ["swiftui", "ios app", "swift"], { languages: ["Swift", "Objective-C"], topics: ["ios", "swiftui"] }],
    ["android", "Android development", ["android app", "jetpack compose", "kotlin"], { languages: ["Kotlin"], topics: ["android"] }],
    ["java", "Java", [], { languages: ["Java"] }],
    ["spring", "Spring Boot", ["spring"], { topics: ["spring-boot", "spring"] }],
    ["csharp", "C#", ["c sharp", ".net", "dotnet", "asp.net"], { languages: ["C#"], topics: ["dotnet", "csharp"] }],
    ["cpp", "C / C++", ["c++", "cplusplus", "c"], { languages: ["C++", "C"] }],
    ["go", "Go", ["golang"], { languages: ["Go"], topics: ["golang"] }],
    ["rust", "Rust", [], { languages: ["Rust"] }],
    ["ruby", "Ruby on Rails", ["rails", "ror", "ruby"], { languages: ["Ruby"], topics: ["rails", "ruby-on-rails"] }],
    ["webflow", "Webflow", []],
    ["wix-squarespace", "Wix / Squarespace", ["wix", "squarespace"]],
    ["no-code", "No-code tools", ["zapier", "make.com", "bubble", "airtable", "n8n"]],
    ["postgresql", "PostgreSQL", ["postgres"], { topics: ["postgresql", "postgres"] }],
    ["mysql", "MySQL", [], { topics: ["mysql"] }],
    ["mongodb", "MongoDB", ["mongo"], { topics: ["mongodb"] }],
    ["firebase", "Firebase", [], { topics: ["firebase"] }],
    ["supabase", "Supabase", [], { topics: ["supabase"] }],
    ["graphql", "GraphQL", [], { topics: ["graphql"] }],
    ["rest-api", "APIs & integrations", ["api", "apis", "rest api", "api integration"], { topics: ["rest-api", "api"] }],
    ["payments", "Payments integration", ["stripe", "paypal"], { topics: ["stripe"] }],
    ["aws", "AWS", ["amazon web services"], { topics: ["aws"] }],
    ["gcp", "Google Cloud", ["gcp"], { topics: ["gcp", "google-cloud"] }],
    ["azure", "Azure", [], { topics: ["azure"] }],
    ["docker", "Docker", [], { languages: ["Dockerfile"], topics: ["docker"] }],
    ["kubernetes", "Kubernetes", ["k8s"], { topics: ["kubernetes"] }],
    ["devops", "DevOps & CI/CD", ["ci/cd", "github actions", "terraform"], { languages: ["HCL"], topics: ["devops", "terraform"] }],
    ["linux", "Linux & servers", ["sysadmin", "bash", "vps"], { languages: ["Shell"] }],
    ["automation", "Scripting & automation", ["automation", "scripting"], { topics: ["automation"] }],
    ["bots", "Discord & Telegram bots", ["discord bot", "telegram bot", "chatbot"], { topics: ["discord-bot", "telegram-bot"] }],
    ["browser-extensions", "Browser extensions", ["chrome extension"], { topics: ["chrome-extension"] }],
    ["desktop-apps", "Desktop apps", ["electron", "tauri"], { topics: ["electron", "tauri"] }],
    ["blockchain", "Blockchain & smart contracts", ["solidity", "web3", "smart contracts"], { languages: ["Solidity"], topics: ["web3", "solidity", "ethereum"] }],
    ["qa-testing", "QA & testing", ["testing", "playwright", "cypress", "selenium testing"], { topics: ["testing", "playwright", "cypress"] }],
  ]),
  ...group("games", [
    ["unity", "Unity", ["unity3d"], { languages: ["ShaderLab"], topics: ["unity", "unity3d"] }],
    ["unreal", "Unreal Engine", ["ue5", "ue4", "blueprints"], { topics: ["unreal-engine"] }],
    ["godot", "Godot", [], { languages: ["GDScript"], topics: ["godot"] }],
    ["roblox", "Roblox", ["luau", "roblox studio"], { languages: ["Luau"], topics: ["roblox"] }],
    ["game-design", "Game design", ["level design"]],
    ["game-art", "Game art & assets", ["game assets", "2d assets"]],
    ["pixel-art", "Pixel art", ["sprites"]],
    ["minecraft", "Minecraft plugins & mods", ["spigot", "minecraft mods"], { topics: ["minecraft", "spigot"] }],
    ["fivem", "FiveM & GTA mods", ["gta mods"], { topics: ["fivem"] }],
    ["gamemaker", "GameMaker", [], { languages: ["Game Maker Language"] }],
    ["lua", "Lua scripting", [], { languages: ["Lua"] }],
  ]),
  ...group("design", [
    ["logo-design", "Logo design", ["logo", "logos"]],
    ["brand-identity", "Brand identity", ["branding", "brand design", "style guide"]],
    ["graphic-design", "Graphic design", ["graphics"]],
    ["ui-design", "UI design", ["user interface", "web design", "app design"]],
    ["ux-design", "UX design", ["ux", "user research", "wireframing", "prototyping"]],
    ["figma", "Figma", []],
    ["illustrator", "Adobe Illustrator", ["illustrator"]],
    ["indesign", "Adobe InDesign", ["indesign"]],
    ["canva", "Canva", []],
    ["social-media-graphics", "Social media graphics", ["instagram posts", "banners"]],
    ["print-design", "Print design", ["flyers", "posters", "brochures", "business cards"]],
    ["packaging-design", "Packaging design", ["packaging", "label design"]],
    ["presentation-design", "Presentation design", ["pitch deck", "powerpoint", "slides", "keynote"]],
    ["merch-design", "T-shirt & merch design", ["t-shirt design", "apparel design", "merch"]],
    ["book-cover-design", "Book cover design", ["book cover"]],
    ["infographics", "Infographics", []],
  ]),
  ...group("art", [
    ["illustration", "Illustration", ["illustrations"]],
    ["digital-art", "Digital art", ["digital painting"]],
    ["character-design", "Character design", ["character art"]],
    ["concept-art", "Concept art", []],
    ["anime-art", "Anime art", ["anime style"]],
    ["comics", "Comics & manga", ["comic art", "manga", "webtoon"]],
    ["portraits", "Portraits", ["portrait", "pet portrait"]],
    ["vtuber-art", "VTuber models & art", ["vtuber", "live2d", "vtuber model"]],
    ["emotes", "Emotes & badges", ["twitch emotes", "discord emotes"]],
    ["childrens-books", "Children's book illustration", ["kids book"]],
    ["tattoo-design", "Tattoo design", ["tattoo"]],
    ["traditional-art", "Traditional art", ["painting", "drawing", "watercolor"]],
    ["procreate", "Procreate", []],
  ]),
  ...group("3d", [
    ["blender", "Blender", [], { topics: ["blender"] }],
    ["3d-modeling", "3D modeling", ["3d model", "3d models"]],
    ["3d-animation", "3D animation", []],
    ["rigging", "Rigging", []],
    ["texturing", "Texturing", ["substance painter", "pbr"]],
    ["product-rendering", "Product rendering", ["3d render", "rendering", "keyshot"]],
    ["archviz", "Architectural visualization", ["sketchup", "3ds max"]],
    ["cad", "CAD", ["autocad", "solidworks", "fusion 360"]],
    ["3d-printing", "3D printing models", ["stl", "3d print"]],
    ["maya", "Maya", ["autodesk maya"]],
    ["zbrush", "ZBrush", ["sculpting"]],
    ["cinema-4d", "Cinema 4D", ["c4d"]],
    ["vrchat-avatars", "VRChat avatars", ["vrchat"]],
  ]),
  ...group("video", [
    ["video-editing", "Video editing", ["video editor", "video edit"]],
    ["youtube-editing", "YouTube editing", ["youtube videos"]],
    ["short-form-video", "Short-form video", ["tiktok", "reels", "shorts"]],
    ["premiere-pro", "Premiere Pro", ["premiere", "adobe premiere"]],
    ["after-effects", "After Effects", ["ae"]],
    ["davinci-resolve", "DaVinci Resolve", ["resolve"]],
    ["final-cut-pro", "Final Cut Pro", ["fcp", "final cut"]],
    ["capcut", "CapCut", []],
    ["motion-graphics", "Motion graphics", ["motion design", "mograph"]],
    ["2d-animation", "2D animation", ["animation", "explainer video"]],
    ["thumbnails", "Thumbnail design", ["thumbnail", "youtube thumbnails"]],
    ["color-grading", "Color grading", ["colour grading", "color correction"]],
    ["subtitles", "Subtitles & captions", ["captions", "subtitling"]],
    ["vfx", "VFX", ["visual effects", "compositing"]],
    ["videography", "Videography", ["filming", "camera operator"]],
  ]),
  ...group("photo", [
    ["photoshop", "Photoshop", ["adobe photoshop", "ps"]],
    ["photo-retouching", "Photo retouching", ["retouching", "skin retouch"]],
    ["photo-restoration", "Photo restoration", ["restoration", "colorization"]],
    ["photo-manipulation", "Photo manipulation", ["photoshop edits"]],
    ["background-removal", "Background removal", ["remove background", "cutout"]],
    ["product-photo-editing", "Product photo editing", ["ecommerce photos"]],
    ["real-estate-photo-editing", "Real estate photo editing", ["virtual staging", "hdr"]],
    ["lightroom", "Lightroom", []],
    ["photography", "Photography", ["photographer", "photoshoot"]],
  ]),
  ...group("audio", [
    ["voice-over", "Voice-over", ["voice acting", "voiceover", "vo"]],
    ["music-production", "Music production", ["beats", "producer"]],
    ["mixing-mastering", "Mixing & mastering", ["mixing", "mastering"]],
    ["podcast-editing", "Podcast editing", ["podcast"]],
    ["audio-editing", "Audio editing", ["audio cleanup"]],
    ["sound-design", "Sound design", ["sfx", "sound effects"]],
    ["composing", "Composing", ["composer", "soundtrack", "game music"]],
    ["audiobook-narration", "Audiobook narration", ["narration", "audiobook"]],
    ["singing", "Singing & vocals", ["vocals", "singer"]],
    ["jingles", "Jingles", []],
  ]),
  ...group("writing", [
    ["copywriting", "Copywriting", ["copy", "sales copy"]],
    ["content-writing", "Content writing", ["blog posts", "articles", "blogging"]],
    ["seo-writing", "SEO writing", ["seo content"]],
    ["ghostwriting", "Ghostwriting", ["ghostwriter"]],
    ["editing-proofreading", "Editing & proofreading", ["proofreading", "copyediting", "line editing"]],
    ["technical-writing", "Technical writing", ["documentation", "docs"]],
    ["scriptwriting", "Scriptwriting", ["scripts", "youtube scripts", "screenwriting"]],
    ["creative-writing", "Creative writing", ["fiction", "short stories"]],
    ["resume-writing", "Resume writing", ["cv writing", "cover letters"]],
    ["grant-writing", "Grant writing", ["grants", "proposals"]],
    ["ux-writing", "UX writing", ["microcopy"]],
    ["product-descriptions", "Product descriptions", []],
    ["newsletter-writing", "Newsletter writing", []],
    ["translation", "Translation", ["translator", "localization"]],
    ["transcription", "Transcription", ["transcribe"]],
  ]),
  ...group("marketing", [
    ["seo", "SEO", ["search engine optimization"]],
    ["social-media-management", "Social media management", ["smm", "social media manager", "community management"]],
    ["paid-ads", "Paid ads", ["ppc", "google ads", "facebook ads", "meta ads"]],
    ["email-marketing", "Email marketing", ["klaviyo", "mailchimp", "newsletters"]],
    ["ugc", "UGC content", ["ugc creator", "user-generated content"]],
    ["content-marketing", "Content marketing", []],
    ["marketing-strategy", "Marketing strategy", ["growth", "go-to-market"]],
    ["lead-generation", "Lead generation", ["leads", "cold outreach", "cold email"]],
    ["analytics-tracking", "Analytics & tracking", ["google analytics", "ga4", "tag manager"]],
    ["marketplace-listings", "Amazon & Etsy listings", ["amazon fba", "etsy seo", "listings"]],
    ["influencer-marketing", "Influencer marketing", []],
    ["pr-outreach", "PR & outreach", ["public relations", "press release"]],
  ]),
  ...group("data", [
    ["data-analysis", "Data analysis", ["analytics", "data analyst"]],
    ["excel", "Excel & Google Sheets", ["spreadsheets", "google sheets", "vba"], { languages: ["VBA"] }],
    ["sql", "SQL", [], { languages: ["TSQL", "PLpgSQL", "PLSQL"] }],
    ["dashboards", "Power BI & Tableau", ["power bi", "tableau", "dashboards"]],
    ["web-scraping", "Web scraping", ["scraper", "scraping", "crawler"], { topics: ["web-scraping", "scraper", "puppeteer"] }],
    ["llm-apps", "AI & LLM apps", ["chatgpt", "openai", "gpt", "ai agents", "rag", "langchain"], { topics: ["llm", "openai", "langchain", "rag"] }],
    ["machine-learning", "Machine learning", ["ml", "deep learning", "pytorch", "tensorflow"], { languages: ["Jupyter Notebook"], topics: ["machine-learning", "deep-learning", "pytorch", "tensorflow"] }],
    ["computer-vision", "Computer vision", ["opencv", "image recognition"], { topics: ["computer-vision", "opencv"] }],
    ["data-engineering", "Data engineering", ["etl", "airflow", "data pipelines"]],
    ["statistics", "Statistics", ["spss", "stata", "r"], { languages: ["R"] }],
  ]),
  ...group("admin", [
    ["virtual-assistant", "Virtual assistance", ["va", "virtual assistant"]],
    ["data-entry", "Data entry", []],
    ["customer-support", "Customer support", ["customer service", "support agent"]],
    ["research", "Online research", ["research", "lead research"]],
    ["project-management", "Project management", ["pm", "notion", "asana", "trello"]],
    ["bookkeeping", "Bookkeeping", ["quickbooks", "xero", "accounting"]],
    ["appointment-setting", "Appointment setting", ["cold calling", "sdr"]],
    ["store-management", "E-commerce store management", ["store management", "product listing"]],
    ["community-moderation", "Community moderation", ["discord moderator", "moderation"]],
  ]),
];

export const SKILL_BY_ID: ReadonlyMap<string, Skill> = new Map(
  SKILLS.map((s) => [s.id, s]),
);

export function normalizeSkillName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

const BY_LABEL: ReadonlyMap<string, Skill> = new Map(
  SKILLS.flatMap((s) =>
    [s.id, s.name, ...s.aliases].map((label) => [normalizeSkillName(label), s] as const),
  ),
);

/** Exact lookup by id, name or alias (case- and spacing-insensitive). */
export function findSkill(name: string): Skill | undefined {
  return BY_LABEL.get(normalizeSkillName(name));
}

/** Picker search: exact > prefix > substring; the user's job types first within each rank. */
export function searchSkills(
  query: string,
  options: { categories?: readonly string[]; limit?: number } = {},
): Skill[] {
  const q = normalizeSkillName(query);
  if (!q) return [];
  const preferred = new Set(options.categories ?? []);
  const scored: { skill: Skill; score: number }[] = [];
  for (const skill of SKILLS) {
    if (skill.retired) continue;
    const labels = [skill.name, ...skill.aliases].map(normalizeSkillName);
    const rank = labels.includes(q)
      ? 0
      : labels.some((l) => l.startsWith(q) || l.includes(` ${q}`))
        ? 1
        : labels.some((l) => l.includes(q))
          ? 2
          : -1;
    if (rank < 0) continue;
    scored.push({ skill, score: rank * 2 + (preferred.has(skill.category) ? 0 : 1) });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, options.limit ?? 12)
    .map((s) => s.skill);
}

/** First `limit` (non-retired) skills of the given job types, in taxonomy order. */
export function skillsForCategories(
  categories: readonly string[],
  limit: number,
): Skill[] {
  return SKILLS.filter((s) => !s.retired && categories.includes(s.category)).slice(0, limit);
}
```

Note: with `"edit"` the ranking gives `video-editing` (prefix on "video edit" alias? no — word-prefix via `" edit"` in "video editing", rank 1, preferred category) ahead of `editing-proofreading` (prefix, rank 1, other category). The test pins that.

- [ ] **Step 3: Implement subreddits and countries**

`packages/core/src/subreddits.ts`:

```ts
import type { CategoryId } from "./taxonomy";

export type SeedSubreddit = { name: string; categories: readonly CategoryId[] };

/**
 * Seed list, unverified: the ingestion spec checks each board's rules and hiring tags
 * before polling it. Lowercase, no "r/". Empty `categories` = general board, given to everyone.
 */
export const SUBREDDITS: readonly SeedSubreddit[] = [
  { name: "forhire", categories: [] },
  { name: "hiring", categories: [] },
  { name: "jobbit", categories: [] },
  { name: "freelance_forhire", categories: [] },
  { name: "hireaprogrammer", categories: ["development", "data"] },
  { name: "remotejs", categories: ["development"] },
  { name: "gamedevclassifieds", categories: ["games", "3d", "art", "audio"] },
  { name: "designjobs", categories: ["design"] },
  { name: "hungryartists", categories: ["art", "design", "3d"] },
  { name: "artcommissions", categories: ["art"] },
  { name: "commissions", categories: ["art"] },
  { name: "videoeditingrequests", categories: ["video"] },
  { name: "photoshoprequest", categories: ["photo"] },
  { name: "voiceacting", categories: ["audio"] },
  { name: "hireawriter", categories: ["writing"] },
  { name: "freelancewriters", categories: ["writing"] },
];

export function subredditsFor(categories: readonly string[]): string[] {
  return SUBREDDITS.filter(
    (s) => s.categories.length === 0 || s.categories.some((c) => categories.includes(c)),
  ).map((s) => s.name);
}
```

`packages/core/src/countries.ts`:

```ts
// ISO 3166-1 alpha-2. Display names come from Intl.DisplayNames in the browser.
export const COUNTRY_CODES: readonly string[] = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ " +
  "BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM " +
  "DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS " +
  "GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN " +
  "KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ " +
  "MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM " +
  "PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV " +
  "SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI " +
  "VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const COUNTRY_SET = new Set(COUNTRY_CODES);
export const isCountryCode = (value: string) => COUNTRY_SET.has(value);

const EUROZONE = new Set(
  "AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" "),
);

export function defaultCurrency(country: string | null): "USD" | "GBP" | "EUR" | "INR" {
  if (country === "IN") return "INR";
  if (country === "GB") return "GBP";
  if (country && EUROZONE.has(country)) return "EUR";
  return "USD";
}
```

Update `packages/core/src/index.ts`:

```ts
export * from "./countries";
export * from "./ids";
export * from "./subreddits";
export * from "./taxonomy";
```

Run: `npm test -w @redlance/core && npm run typecheck -w @redlance/core`
Expected: PASS. If the alias-uniqueness test fails, rename or drop the clashing alias; don't loosen the test.

- [ ] **Step 4: Commit**

```bash
git add packages/core
git commit -m "Add the skill taxonomy, subreddit seed list and country codes to @redlance/core"
```

---

### Task 3: Step schemas and `resumeAt()`

**Files:**
- Create: `packages/core/src/onboarding.ts`, `packages/core/src/onboarding.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `STEP_IDS`, `StepId`, `PAGE_IDS`, `PageId`, `PAGE_TITLES`, `StepStatus`, `TRIAL_DAYS = 5`, `LIMITS`
  - `EXPERIENCE_LEVELS`, `SKILL_LEVELS`, `SOURCES`, `CURRENCIES`, `RATE_TYPES`
  - `STEP_SCHEMAS: { [S in StepId]: { draft; complete } }`, `StepDraft<S>`, `StepData<S>`, `emptyDraft(step)`
  - `resumeAt(rows)`, `pageIndex(page)`, `canOpen(page, resume)`, `nextPage(step)`, `previousPage(page)`, `isStepId(v)`, `isPageId(v)`
  - `FieldError = { path: string; message: string }`, `toFieldErrors(error, prefix?)`
  - `isValidTimeZone(v)`, `GITHUB_USERNAME_RE`, `parseGithubUsername(input)`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/onboarding.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  STEP_SCHEMAS,
  canOpen,
  emptyDraft,
  isValidTimeZone,
  nextPage,
  parseGithubUsername,
  resumeAt,
  toFieldErrors,
} from "./onboarding";

const basics = {
  displayName: "Asha",
  headline: "Video editor for YouTubers",
  categories: ["video"],
  experienceLevel: "intermediate",
  country: "IN",
  timeZone: "Asia/Kolkata",
};

describe("resumeAt / page helpers", () => {
  it("starts at import, skips completed steps, stops at the first draft", () => {
    expect(resumeAt([])).toBe("import");
    expect(
      resumeAt([
        { step: "import", status: "completed" },
        { step: "basics", status: "draft" },
      ]),
    ).toBe("basics");
    expect(
      resumeAt(
        ["import", "basics", "skills", "rates"].map((step) => ({
          step,
          status: "completed" as const,
        })),
      ),
    ).toBe("review");
  });

  it("lets users open earlier pages but not later ones", () => {
    expect(canOpen("import", "skills")).toBe(true);
    expect(canOpen("skills", "skills")).toBe(true);
    expect(canOpen("rates", "skills")).toBe(false);
    expect(nextPage("rates")).toBe("review");
  });
});

describe("basics", () => {
  it("accepts a complete step and trims text", () => {
    const parsed = STEP_SCHEMAS.basics.complete.parse({ ...basics, displayName: "  Asha " });
    expect(parsed.displayName).toBe("Asha");
  });

  it("lets a draft be empty, but not over the limits", () => {
    expect(STEP_SCHEMAS.basics.draft.parse({})).toEqual(emptyDraft("basics"));
    expect(
      STEP_SCHEMAS.basics.draft.safeParse({ displayName: "x".repeat(61) }).success,
    ).toBe(false);
  });

  it("requires the fields with friendly messages", () => {
    const result = STEP_SCHEMAS.basics.complete.safeParse(emptyDraft("basics"));
    expect(result.success).toBe(false);
    const paths = toFieldErrors(result.error!).map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(["displayName", "categories", "experienceLevel", "country", "timeZone"]),
    );
  });

  it("rejects unknown keys, unknown categories, duplicates, >3 job types, bad countries and zones", () => {
    const bad = (patch: object) =>
      STEP_SCHEMAS.basics.complete.safeParse({ ...basics, ...patch }).success;
    expect(bad({ extra: 1 })).toBe(false);
    expect(bad({ categories: ["knitting"] })).toBe(false);
    expect(bad({ categories: ["video", "video"] })).toBe(false);
    expect(bad({ categories: ["video", "design", "art", "audio"] })).toBe(false);
    expect(bad({ country: "XX" })).toBe(false);
    expect(bad({ timeZone: "Mars/Olympus" })).toBe(false);
  });

  it("accepts legacy time zone aliases that browsers still report", () => {
    expect(isValidTimeZone("Asia/Calcutta")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("+05:30")).toBe(false);
  });
});

describe("skills", () => {
  const skill = (id: string, level = "core") => ({ id, level });

  it("needs at least one core skill to complete, not to draft", () => {
    const data = { skills: [skill("react", "secondary")], customSkills: [] };
    expect(STEP_SCHEMAS.skills.draft.safeParse(data).success).toBe(true);
    expect(STEP_SCHEMAS.skills.complete.safeParse(data).success).toBe(false);
  });

  it("defaults source to manual", () => {
    const parsed = STEP_SCHEMAS.skills.complete.parse({ skills: [skill("react")] });
    expect(parsed.skills[0]!.source).toBe("manual");
  });

  it("caps core at 8 and total at 30, refuses unknown ids and duplicates, even in drafts", () => {
    const ids = ["react", "nextjs", "nodejs", "python", "django", "vue", "svelte", "php", "laravel"];
    const tooManyCore = { skills: ids.map((id) => skill(id)) };
    expect(STEP_SCHEMAS.skills.draft.safeParse(tooManyCore).success).toBe(false);
    expect(STEP_SCHEMAS.skills.draft.safeParse({ skills: [skill("nope")] }).success).toBe(false);
    expect(
      STEP_SCHEMAS.skills.draft.safeParse({ skills: [skill("react"), skill("react")] }).success,
    ).toBe(false);
    expect(
      STEP_SCHEMAS.skills.draft.safeParse({
        customSkills: [
          { name: "Three.js", level: "secondary" },
          { name: " three.JS ", level: "secondary" },
        ],
      }).success,
    ).toBe(false);
    const thirtyOne = {
      skills: [skill("react")],
      customSkills: Array.from({ length: 30 }, (_, i) => ({ name: `Tool ${i}`, level: "secondary" })),
    };
    expect(STEP_SCHEMAS.skills.draft.safeParse(thirtyOne).success).toBe(false);
  });
});

describe("GitHub link", () => {
  it("accepts a username or a github.com URL and keeps just the username", () => {
    expect(parseGithubUsername("octocat")).toBe("octocat");
    expect(parseGithubUsername(" @octocat ")).toBe("octocat");
    expect(parseGithubUsername("github.com/octocat")).toBe("octocat");
    expect(parseGithubUsername("https://www.github.com/octo-cat/some-repo?tab=repositories")).toBe("octo-cat");
    expect(parseGithubUsername("   ")).toBeNull();
  });

  it("refuses things that can't be a GitHub username", () => {
    expect(parseGithubUsername("-octocat")).toBeNull();
    expect(parseGithubUsername("octo--cat")).toBeNull();
    expect(parseGithubUsername("a".repeat(40))).toBeNull();
    expect(parseGithubUsername("https://gitlab.com/octocat")).toBeNull();
    expect(parseGithubUsername("octo cat")).toBeNull();
  });
});

describe("rates", () => {
  const rates = { minRate: 25, currency: "USD", rateType: "hourly", remoteOnly: true, blockedWords: ["unpaid"] };

  it("accepts a complete step", () => {
    expect(STEP_SCHEMAS.rates.complete.parse(rates)).toEqual(rates);
  });

  it("allows 0 (any budget) but refuses negatives, >100000, 3 decimals, NaN", () => {
    const ok = (minRate: unknown) => STEP_SCHEMAS.rates.complete.safeParse({ ...rates, minRate }).success;
    expect(ok(0)).toBe(true);
    expect(ok(12.5)).toBe(true);
    expect(ok(-1)).toBe(false);
    expect(ok(100_001)).toBe(false);
    expect(ok(1.005)).toBe(false);
    expect(ok(Number.NaN)).toBe(false);
    expect(ok("25")).toBe(false);
  });

  it("refuses duplicate blocked words ignoring case, and more than 50", () => {
    const words = (blockedWords: string[]) =>
      STEP_SCHEMAS.rates.draft.safeParse({ blockedWords }).success;
    expect(words(["Unpaid", "unpaid"])).toBe(false);
    expect(words(Array.from({ length: 51 }, (_, i) => `w${i}`))).toBe(false);
  });
});

describe("import", () => {
  it("stores an optional GitHub username, and only a bare username", () => {
    expect(STEP_SCHEMAS.import.complete.parse({})).toEqual({ githubUsername: null });
    expect(STEP_SCHEMAS.import.complete.parse({ githubUsername: "octocat" })).toEqual({ githubUsername: "octocat" });
    expect(STEP_SCHEMAS.import.complete.safeParse({ githubUsername: "github.com/octocat" }).success).toBe(false);
    expect(STEP_SCHEMAS.import.complete.safeParse({ githubUsername: null, file: "x" }).success).toBe(false);
  });
});

describe("toFieldErrors", () => {
  it("joins paths and adds a prefix", () => {
    const result = STEP_SCHEMAS.rates.complete.safeParse({ minRate: -1, blockedWords: ["a", "A"] });
    const errors = toFieldErrors(result.error!, "data");
    expect(errors.map((e) => e.path)).toEqual(
      expect.arrayContaining(["data.minRate", "data.blockedWords.1"]),
    );
  });
});
```

Run: `npm test -w @redlance/core`
Expected: FAIL (`./onboarding` not found).

- [ ] **Step 2: Implement**

`packages/core/src/onboarding.ts`:

```ts
import { z } from "zod";
import { isCountryCode } from "./countries";
import { CATEGORY_IDS, SKILL_BY_ID, normalizeSkillName } from "./taxonomy";

export const STEP_IDS = ["import", "basics", "skills", "rates"] as const;
export type StepId = (typeof STEP_IDS)[number];
export const PAGE_IDS = [...STEP_IDS, "review"] as const;
export type PageId = (typeof PAGE_IDS)[number];
export type StepStatus = "draft" | "completed";

export const PAGE_TITLES: Record<PageId, string> = {
  import: "Import",
  basics: "Basics",
  skills: "Skills",
  rates: "Rates & filters",
  review: "Review",
};

export const TRIAL_DAYS = 5;
export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "experienced"] as const;
export const SKILL_LEVELS = ["core", "secondary"] as const;
export const SOURCES = ["manual", "resume", "github"] as const;
export const CURRENCIES = ["USD", "GBP", "EUR", "INR"] as const;
export const RATE_TYPES = ["hourly", "fixed", "either"] as const;

export const LIMITS = {
  displayName: 60,
  headline: 120,
  categories: 3,
  coreSkills: 8,
  totalSkills: 30,
  customSkillName: 40,
  maxRate: 100_000,
  blockedWords: 50,
  blockedWord: 40,
} as const;

// ---------- small validators (also used by the forms) ----------

export const GITHUB_USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * "octocat", "@octocat" or any github.com/<name>/… URL → "octocat".
 * null when the input is empty or can't be a GitHub username.
 */
export function parseGithubUsername(input: string): string | null {
  let value = input.trim().replace(/^@/, "");
  if (!value) return null;
  const fromUrl = value.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)/i);
  if (fromUrl) value = fromUrl[1]!;
  else if (/[/.:]/.test(value)) return null;
  return GITHUB_USERNAME_RE.test(value) ? value : null;
}

const TZ_RE = /^(?:UTC|[A-Za-z][A-Za-z_-]*(?:\/[A-Za-z0-9_+-]+){1,2})$/;

export function isValidTimeZone(value: string): boolean {
  if (!TZ_RE.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

// ---------- field schemas ----------

const text = (max: number) =>
  z.string().trim().max(max, `Keep it to ${max} characters or fewer.`);
const categoryId = z.enum(CATEGORY_IDS, { error: "Pick a job type from the list." });
const skillId = z.string().refine((id) => SKILL_BY_ID.has(id), "Unknown skill.");
const source = z.enum(SOURCES).default("manual");
const country = z
  .string({ error: "Pick your country." })
  .refine(isCountryCode, "Pick your country.");
const timeZone = z
  .string({ error: "Pick your time zone." })
  .max(64)
  .refine(isValidTimeZone, "Pick your time zone.");
const rate = z
  .number({ error: "Enter a number." })
  .min(0, "Can't be negative.")
  .max(LIMITS.maxRate, "That's above the limit.")
  .refine(twoDecimals, "Use at most 2 decimal places.");

type Ctx = z.RefinementCtx;

function noDuplicates<T>(
  items: readonly T[],
  key: (item: T) => string,
  ctx: Ctx,
  path: (string | number)[],
  message: string,
) {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const k = key(item);
    if (k && seen.has(k)) ctx.addIssue({ code: "custom", message, path: [...path, i] });
    seen.add(k);
  });
}

// ---------- steps ----------

// Import step: an optional GitHub link, stored as the bare username (the form parses URLs).
const importData = z.strictObject({
  githubUsername: z
    .string()
    .regex(GITHUB_USERNAME_RE, "That doesn't look like a GitHub username.")
    .nullable()
    .default(null),
});

const basicsShape = {
  headline: text(LIMITS.headline).default(""),
};
const categoriesRefine = (v: { categories: string[] }, ctx: Ctx) =>
  noDuplicates(v.categories, (c) => c, ctx, ["categories"], "Each job type once.");

const basicsDraft = z
  .strictObject({
    ...basicsShape,
    displayName: text(LIMITS.displayName).default(""),
    categories: z.array(categoryId).max(LIMITS.categories, "Pick up to 3 job types.").default([]),
    experienceLevel: z.enum(EXPERIENCE_LEVELS).nullable().default(null),
    country: country.nullable().default(null),
    timeZone: timeZone.nullable().default(null),
  })
  .superRefine(categoriesRefine);

const basicsComplete = z
  .strictObject({
    ...basicsShape,
    displayName: text(LIMITS.displayName).min(1, "Add the name clients will see."),
    categories: z
      .array(categoryId)
      .min(1, "Pick at least one job type.")
      .max(LIMITS.categories, "Pick up to 3 job types."),
    experienceLevel: z.enum(EXPERIENCE_LEVELS, { error: "Pick your experience level." }),
    country,
    timeZone,
  })
  .superRefine(categoriesRefine);

const skillEntry = z.strictObject({ id: skillId, level: z.enum(SKILL_LEVELS), source });
const customSkillEntry = z.strictObject({
  name: text(LIMITS.customSkillName).min(1, "Name the skill."),
  level: z.enum(SKILL_LEVELS),
  source,
});

function skillsSchema(requireCore: boolean) {
  return z
    .strictObject({
      skills: z.array(skillEntry).max(LIMITS.totalSkills).default([]),
      customSkills: z.array(customSkillEntry).max(LIMITS.totalSkills).default([]),
    })
    .superRefine((v, ctx) => {
      noDuplicates(v.skills, (s) => s.id, ctx, ["skills"], "Already added.");
      noDuplicates(v.customSkills, (s) => normalizeSkillName(s.name), ctx, ["customSkills"], "Already added.");
      const all = [...v.skills, ...v.customSkills];
      const core = all.filter((s) => s.level === "core").length;
      if (all.length > LIMITS.totalSkills)
        ctx.addIssue({ code: "custom", path: ["skills"], message: `Keep it to ${LIMITS.totalSkills} skills.` });
      if (core > LIMITS.coreSkills)
        ctx.addIssue({ code: "custom", path: ["skills"], message: `Mark up to ${LIMITS.coreSkills} skills as core.` });
      if (requireCore && core === 0)
        ctx.addIssue({ code: "custom", path: ["skills"], message: "Mark at least one skill as core." });
    });
}

const blockedWords = z
  .array(text(LIMITS.blockedWord).min(1))
  .max(LIMITS.blockedWords, `Up to ${LIMITS.blockedWords} words.`)
  .default([]);
const wordsRefine = (v: { blockedWords: string[] }, ctx: Ctx) =>
  noDuplicates(v.blockedWords, (w) => w.toLowerCase(), ctx, ["blockedWords"], "Already added.");

const ratesDraft = z
  .strictObject({
    minRate: rate.nullable().default(null),
    currency: z.enum(CURRENCIES).nullable().default(null),
    rateType: z.enum(RATE_TYPES).nullable().default(null),
    remoteOnly: z.boolean().default(false),
    blockedWords,
  })
  .superRefine(wordsRefine);
const ratesComplete = z
  .strictObject({
    minRate: rate,
    currency: z.enum(CURRENCIES, { error: "Pick a currency." }),
    rateType: z.enum(RATE_TYPES, { error: "Pick hourly, fixed or either." }),
    remoteOnly: z.boolean().default(false),
    blockedWords,
  })
  .superRefine(wordsRefine);

export const STEP_SCHEMAS = {
  import: { draft: importData, complete: importData },
  basics: { draft: basicsDraft, complete: basicsComplete },
  skills: { draft: skillsSchema(false), complete: skillsSchema(true) },
  rates: { draft: ratesDraft, complete: ratesComplete },
} as const;

export type StepDraft<S extends StepId> = z.output<(typeof STEP_SCHEMAS)[S]["draft"]>;
export type StepData<S extends StepId> = z.output<(typeof STEP_SCHEMAS)[S]["complete"]>;

export function emptyDraft<S extends StepId>(step: S): StepDraft<S> {
  return STEP_SCHEMAS[step].draft.parse({}) as StepDraft<S>;
}

// ---------- order ----------

export const isStepId = (v: string): v is StepId => (STEP_IDS as readonly string[]).includes(v);
export const isPageId = (v: string): v is PageId => (PAGE_IDS as readonly string[]).includes(v);
export const pageIndex = (page: PageId) => PAGE_IDS.indexOf(page);

/** First step that is missing or a draft; "review" once all are completed. */
export function resumeAt(rows: ReadonlyArray<{ step: string; status: StepStatus }>): PageId {
  const done = new Set(rows.filter((r) => r.status === "completed").map((r) => r.step));
  return STEP_IDS.find((s) => !done.has(s)) ?? "review";
}

export const canOpen = (page: PageId, resume: PageId) => pageIndex(page) <= pageIndex(resume);
export const nextPage = (step: StepId): PageId => PAGE_IDS[pageIndex(step) + 1]!;
export const previousPage = (page: PageId): PageId | null =>
  pageIndex(page) > 0 ? PAGE_IDS[pageIndex(page) - 1]! : null;

// ---------- errors ----------

export type FieldError = { path: string; message: string };

export function toFieldErrors(error: z.ZodError, prefix?: string): FieldError[] {
  return error.issues.map((issue) => ({
    path: [...(prefix ? [prefix] : []), ...issue.path.map(String)].join("."),
    message: issue.message,
  }));
}
```

Add `export * from "./onboarding";` to `packages/core/src/index.ts`.

Run: `npm test -w @redlance/core && npm run typecheck -w @redlance/core`
Expected: PASS.

If `z.RefinementCtx` is not exported by this zod version, type the helpers' `ctx` as `z.core.$RefinementCtx` (same shape); check with `npm run typecheck`.

- [ ] **Step 3: Commit**

```bash
git add packages/core
git commit -m "Add onboarding step schemas and resumeAt() to @redlance/core"
```

---

### Task 4: Onboarding and profile tables, and the reference-data sync

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/src/index.ts`, `packages/db/src/migrate.ts`, `packages/db/src/migrate-cli.ts`, `packages/db/package.json`
- Create: `packages/db/src/reference.ts`, `packages/db/src/onboarding.test.ts`, `packages/db/migrations/0002_onboarding.sql` (generated)

**Interfaces:**
- Consumes: `SKILLS`, `SUBREDDITS`, `STEP_IDS` and the value lists from `@redlance/core`.
- Produces: Drizzle tables `skills`, `subreddits`, `onboardingSteps`, `profiles`, `profileSkills`, `customSkills`, `userSubreddits`, `alertChannels`; `syncReferenceData(db)`; `prepareDatabase(url)` (migrate + sync).

- [ ] **Step 1: Add dependencies**

```bash
npm install @redlance/core@* uuid@^14 -w @redlance/db
```

(`@redlance/core@*` resolves to the workspace package; check `packages/db/package.json` shows `"@redlance/core": "*"`.)

- [ ] **Step 2: Write the failing tests**

`packages/db/src/onboarding.test.ts`:

```ts
import {
  CURRENCIES,
  EXPERIENCE_LEVELS,
  RATE_TYPES,
  SKILLS,
  SKILL_LEVELS,
  SOURCES,
  STEP_IDS,
  SUBREDDITS,
} from "@redlance/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ONBOARDING_STEP_IDS,
  PROFILE_CURRENCIES,
  PROFILE_EXPERIENCE_LEVELS,
  PROFILE_RATE_TYPES,
  SKILL_LEVEL_VALUES,
  SKILL_SOURCE_VALUES,
  createDb,
  customSkills,
  onboardingSteps,
  pgErrorCode,
  profileSkills,
  skills,
  subreddits,
  users,
} from "./index";
import { runMigrations } from "./migrate";
import { syncReferenceData } from "./reference";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 2 });

beforeAll(async () => {
  await runMigrations(url);
  await syncReferenceData(db);
});
beforeEach(async () => {
  await db.execute(sql`truncate table users cascade`);
});
afterAll(async () => {
  await pool.end();
});

async function newUser() {
  const [u] = await db
    .insert(users)
    .values({ authSub: `dev|${Math.random()}`, email: "a@example.com", emailNormalized: `${Math.random()}@example.com` })
    .returning();
  return u!.id;
}

const code = (code: string) => (err: unknown) => pgErrorCode(err) === code;

describe("value lists match @redlance/core", () => {
  it("uses the same literals as the step schemas", () => {
    expect(ONBOARDING_STEP_IDS).toEqual(STEP_IDS);
    expect(PROFILE_EXPERIENCE_LEVELS).toEqual(EXPERIENCE_LEVELS);
    expect(PROFILE_CURRENCIES).toEqual(CURRENCIES);
    expect(PROFILE_RATE_TYPES).toEqual(RATE_TYPES);
    expect(SKILL_LEVEL_VALUES).toEqual(SKILL_LEVELS);
    expect(SKILL_SOURCE_VALUES).toEqual(SOURCES);
  });
});

describe("onboarding_steps", () => {
  it("rejects unknown steps and statuses", async () => {
    const userId = await newUser();
    await expect(
      db.execute(sql`insert into onboarding_steps (user_id, step, status, data) values (${userId}, 'voice', 'draft', '{}')`),
    ).rejects.toSatisfy(code("23514"));
    await expect(
      db.execute(sql`insert into onboarding_steps (user_id, step, status, data) values (${userId}, 'basics', 'done', '{}')`),
    ).rejects.toSatisfy(code("23514"));
  });

  it("rejects data over 64 KB", async () => {
    const userId = await newUser();
    const big = { blob: "x".repeat(70_000) };
    await expect(
      db.insert(onboardingSteps).values({ userId, step: "basics", status: "draft", data: big }),
    ).rejects.toSatisfy(code("23514"));
  });

  it("is deleted with its user", async () => {
    const userId = await newUser();
    await db.insert(onboardingSteps).values({ userId, step: "import", status: "completed", data: { githubUsername: null } });
    await db.delete(users).where(eq(users.id, userId));
    expect(await db.select().from(onboardingSteps)).toHaveLength(0);
  });
});

describe("skills reference data", () => {
  it("loads every taxonomy skill and seed subreddit", async () => {
    expect(await db.$count(skills)).toBe(SKILLS.length);
    expect(await db.$count(subreddits)).toBe(SUBREDDITS.length);
  });

  it("sync is idempotent and never deletes: it retires and deactivates instead", async () => {
    await db.insert(skills).values({ id: "zz-old", name: "Old", category: "development" }).onConflictDoNothing();
    await db.insert(subreddits).values({ name: "zz_old", categories: [] }).onConflictDoNothing();
    await syncReferenceData(db);
    await syncReferenceData(db);
    const [old] = await db.select().from(skills).where(eq(skills.id, "zz-old"));
    expect(old!.retired).toBe(true);
    const [oldSub] = await db.select().from(subreddits).where(eq(subreddits.name, "zz_old"));
    expect(oldSub!.active).toBe(false);
    expect(await db.$count(skills, eq(skills.retired, false))).toBe(SKILLS.filter((s) => !s.retired).length);
  });

  it("profile_skills only accepts known skill ids", async () => {
    const userId = await newUser();
    await expect(
      db.insert(profileSkills).values({ userId, skillId: "not-a-skill", level: "core", source: "manual" }),
    ).rejects.toSatisfy(code("23503"));
  });

  it("gives new rows UUIDv7 ids and refuses a duplicate custom skill per user", async () => {
    const userId = await newUser();
    const [row] = await db
      .insert(customSkills)
      .values({ userId, name: "Three.js", nameNormalized: "three.js", level: "secondary", source: "manual" })
      .returning();
    expect(row!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    await expect(
      db.insert(customSkills).values({ userId, name: "three.js", nameNormalized: "three.js", level: "core", source: "manual" }),
    ).rejects.toSatisfy(code("23505"));
  });
});
```

Run: `npm test -w @redlance/db`
Expected: FAIL (exports missing).

- [ ] **Step 3: Add the tables**

Append to `packages/db/src/schema.ts` (and extend the imports: `boolean, integer, jsonb, primaryKey, unique` from `drizzle-orm/pg-core`, `v7 as uuidv7` from `uuid`). This file must not import `@redlance/core` (see Global Constraints); the literal lists below are checked against core by the test above.

```ts
// Literal lists mirror @redlance/core (checked by onboarding.test.ts). drizzle-kit loads this
// file on its own, so it doesn't import core.
export const ONBOARDING_STEP_IDS = ["import", "basics", "skills", "rates"] as const;
export const STEP_STATUSES = ["draft", "completed"] as const;
export const PROFILE_EXPERIENCE_LEVELS = ["beginner", "intermediate", "experienced"] as const;
export const PROFILE_CURRENCIES = ["USD", "GBP", "EUR", "INR"] as const;
export const PROFILE_RATE_TYPES = ["hourly", "fixed", "either"] as const;
export const SKILL_LEVEL_VALUES = ["core", "secondary"] as const;
export const SKILL_SOURCE_VALUES = ["manual", "resume", "github"] as const;
export const SUBREDDIT_SOURCES = ["auto", "user"] as const;
export const ALERT_KINDS = ["email", "telegram"] as const;

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const userId = () =>
  uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" });
const v7Id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const emptyTextArray = sql`'{}'::text[]`;

export const skills = pgTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  aliases: text("aliases").array().notNull().default(emptyTextArray),
  retired: boolean("retired").notNull().default(false),
});

export const subreddits = pgTable(
  "subreddits",
  {
    name: text("name").primaryKey(),
    categories: text("categories").array().notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [check("subreddits_name_check", sql`${t.name} ~ '^[a-z0-9_]{2,21}$'`)],
);

export const onboardingSteps = pgTable(
  "onboarding_steps",
  {
    userId: userId(),
    step: text("step", { enum: ONBOARDING_STEP_IDS }).notNull(),
    status: text("status", { enum: STEP_STATUSES }).notNull(),
    data: jsonb("data").$type<unknown>().notNull(),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.step] }),
    check("onboarding_steps_step_check", sql`${t.step} in (${sqlList(ONBOARDING_STEP_IDS)})`),
    check("onboarding_steps_status_check", sql`${t.status} in (${sqlList(STEP_STATUSES)})`),
    check("onboarding_steps_data_size_check", sql`pg_column_size(${t.data}) <= 65536`),
  ],
);

export const profiles = pgTable(
  "profiles",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    headline: text("headline").notNull().default(""),
    categories: text("categories").array().notNull(),
    experienceLevel: text("experience_level", { enum: PROFILE_EXPERIENCE_LEVELS }).notNull(),
    country: text("country").notNull(),
    timeZone: text("time_zone").notNull(),
    // Optional GitHub link from the Import step (bare username). Drafts can link it.
    githubUsername: text("github_username"),
    minRateMinor: integer("min_rate_minor").notNull(),
    currency: text("currency", { enum: PROFILE_CURRENCIES }).notNull(),
    rateType: text("rate_type", { enum: PROFILE_RATE_TYPES }).notNull(),
    remoteOnly: boolean("remote_only").notNull(),
    blockedWords: text("blocked_words").array().notNull().default(emptyTextArray),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }).notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("profiles_experience_level_check", sql`${t.experienceLevel} in (${sqlList(PROFILE_EXPERIENCE_LEVELS)})`),
    check("profiles_currency_check", sql`${t.currency} in (${sqlList(PROFILE_CURRENCIES)})`),
    check("profiles_rate_type_check", sql`${t.rateType} in (${sqlList(PROFILE_RATE_TYPES)})`),
    check("profiles_min_rate_check", sql`${t.minRateMinor} between 0 and 10000000`),
    check("profiles_categories_check", sql`cardinality(${t.categories}) between 1 and 3`),
  ],
);

export const profileSkills = pgTable(
  "profile_skills",
  {
    userId: userId(),
    skillId: text("skill_id").notNull().references(() => skills.id),
    level: text("level", { enum: SKILL_LEVEL_VALUES }).notNull(),
    source: text("source", { enum: SKILL_SOURCE_VALUES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.skillId] }),
    check("profile_skills_level_check", sql`${t.level} in (${sqlList(SKILL_LEVEL_VALUES)})`),
    check("profile_skills_source_check", sql`${t.source} in (${sqlList(SKILL_SOURCE_VALUES)})`),
  ],
);

export const customSkills = pgTable(
  "custom_skills",
  {
    id: v7Id(),
    userId: userId(),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    level: text("level", { enum: SKILL_LEVEL_VALUES }).notNull(),
    source: text("source", { enum: SKILL_SOURCE_VALUES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("custom_skills_user_name_unique").on(t.userId, t.nameNormalized),
    check("custom_skills_level_check", sql`${t.level} in (${sqlList(SKILL_LEVEL_VALUES)})`),
    check("custom_skills_source_check", sql`${t.source} in (${sqlList(SKILL_SOURCE_VALUES)})`),
  ],
);

// `subreddit` is plain text, not a foreign key: the dashboard will let users add boards
// outside the seed list. Ingestion decides which ones to poll.
export const userSubreddits = pgTable(
  "user_subreddits",
  {
    userId: userId(),
    subreddit: text("subreddit").notNull(),
    source: text("source", { enum: SUBREDDIT_SOURCES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.subreddit] }),
    check("user_subreddits_source_check", sql`${t.source} in (${sqlList(SUBREDDIT_SOURCES)})`),
  ],
);

export const alertChannels = pgTable(
  "alert_channels",
  {
    id: v7Id(),
    userId: userId(),
    kind: text("kind", { enum: ALERT_KINDS }).notNull(),
    target: text("target").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("alert_channels_user_kind_unique").on(t.userId, t.kind),
    check("alert_channels_kind_check", sql`${t.kind} in (${sqlList(ALERT_KINDS)})`),
  ],
);

export type Profile = typeof profiles.$inferSelect;
```

- [ ] **Step 4: Add the sync and `prepareDatabase`**

`packages/db/src/reference.ts`:

```ts
import { SKILLS, SUBREDDITS } from "@redlance/core";
import { notInArray, sql } from "drizzle-orm";
import type { Database } from "./client";
import { skills, subreddits } from "./schema";

/**
 * Copies the skill taxonomy and subreddit seed list from @redlance/core into Postgres.
 * Upserts only: rows missing from core are retired / deactivated, never deleted, because
 * saved profiles reference them.
 */
export async function syncReferenceData(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    // Two processes starting at once (web tests + db tests) must not interleave.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('redlance:reference-data'))`);

    await tx
      .insert(skills)
      .values(
        SKILLS.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          aliases: [...s.aliases],
          retired: s.retired ?? false,
        })),
      )
      .onConflictDoUpdate({
        target: skills.id,
        set: {
          name: sql`excluded.name`,
          category: sql`excluded.category`,
          aliases: sql`excluded.aliases`,
          retired: sql`excluded.retired`,
        },
      });
    await tx
      .update(skills)
      .set({ retired: true })
      .where(notInArray(skills.id, SKILLS.map((s) => s.id)));

    await tx
      .insert(subreddits)
      .values(SUBREDDITS.map((s) => ({ name: s.name, categories: [...s.categories], active: true })))
      .onConflictDoUpdate({
        target: subreddits.name,
        set: { categories: sql`excluded.categories`, active: sql`true` },
      });
    await tx
      .update(subreddits)
      .set({ active: false })
      .where(notInArray(subreddits.name, SUBREDDITS.map((s) => s.name)));
  });
}
```

Add to `packages/db/src/migrate.ts`:

```ts
import { syncReferenceData } from "./reference";

/** Migrations, then reference data. Used by `npm run db:migrate` and test setup. */
export async function prepareDatabase(url: string): Promise<void> {
  await runMigrations(url);
  const { db, pool } = createDb(url, { max: 1 });
  try {
    await syncReferenceData(db);
  } finally {
    await pool.end();
  }
}
```

`packages/db/src/migrate-cli.ts`: call `prepareDatabase(url)` instead of `runMigrations(url)` and print `"Migrations applied and reference data synced."`.

`packages/db/src/index.ts`: add `export { syncReferenceData } from "./reference";`.

- [ ] **Step 5: Generate and read the migration**

```bash
npm run db:generate -w @redlance/db -- --name onboarding
```

Expected: `packages/db/migrations/0002_onboarding.sql` plus a snapshot. Read the SQL: eight `CREATE TABLE`s, the CHECKs with literal lists (`'import', 'basics', …`), `ON DELETE cascade` on every `user_id`, and **no** changes to `users`. Then:

```bash
npm run db:migrate
npm test -w @redlance/db && npm run typecheck -w @redlance/db
```

Expected: `Migrations applied and reference data synced.` Tests PASS.

- [ ] **Step 6: Use `prepareDatabase` in web test setup and let Next compile core**

`apps/web/test/global-setup.ts`:

```ts
import { prepareDatabase } from "@redlance/db/migrate";
import { TEST_ENV } from "./test-env";

export default async function setup(): Promise<void> {
  await prepareDatabase(TEST_ENV.DATABASE_URL);
}
```

`apps/web/next.config.ts`: `transpilePackages: ["@redlance/db", "@redlance/core"]`.

```bash
npm install @redlance/core@* -w @redlance/web
npm test -w @redlance/web
```

Expected: the existing 100+ web tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db apps/web/test/global-setup.ts apps/web/next.config.ts apps/web/package.json package-lock.json
git commit -m "Add onboarding and profile tables and sync reference data after migrations"
```

---

### Task 5: `apiRoute()` params, JSON body cap and new error codes

**Files:**
- Modify: `apps/web/src/server/errors.ts`, `apps/web/src/server/http.ts`, `apps/web/src/server/api-route.ts`, `apps/web/src/server/api-route.test.ts`, `apps/web/src/server/http.test.ts`

**Interfaces:**
- Produces:
  - Error codes `VERSION_CONFLICT` (409), `STEP_ORDER` (409), `ALREADY_ONBOARDED` (409), `PAYLOAD_TOO_LARGE` (413)
  - `readBody(request, limit): Promise<Buffer>` (413 when over the limit)
  - `apiRoute({ params?: ZodSchema, … })`: handler gets `params`; the returned function is `(request, context?) => Promise<Response>`, where `context.params` is Next's `Promise<…>`
  - `MAX_JSON_BYTES = 256 * 1024`

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/server/http.test.ts`:

```ts
describe("readBody", () => {
  const body = (size: number, headers: Record<string, string> = {}) =>
    new Request("http://localhost/x", { method: "POST", body: "x".repeat(size), headers });

  it("returns the bytes under the limit", async () => {
    expect((await readBody(body(10), 10)).length).toBe(10);
  });

  it("413s when Content-Length is over the limit, before reading", async () => {
    await expect(readBody(body(5, { "content-length": "11" }), 10)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("413s when the stream is longer than the limit (no or lying Content-Length)", async () => {
    await expect(readBody(body(11), 10)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
});
```

Add to `apps/web/src/server/api-route.test.ts`:

```ts
const withParams = apiRoute({
  params: z.object({ step: z.enum(["basics", "skills"]) }),
  handler: async ({ params }) => json(200, { step: params.step }),
});

describe("apiRoute params and body size", () => {
  it("passes validated route params to the handler", async () => {
    const cookie = await cookieFor();
    const res = await withParams(req("/api/v1/x/basics", { headers: { cookie } }), {
      params: Promise.resolve({ step: "basics" }),
    });
    expect(await res.json()).toEqual({ step: "basics" });
  });

  it("404s params that fail the schema", async () => {
    const cookie = await cookieFor();
    const res = await withParams(req("/api/v1/x/nope", { headers: { cookie } }), {
      params: Promise.resolve({ step: "nope" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("413s a JSON body over 256 KB", async () => {
    const cookie = await cookieFor();
    const res = await echo(post(cookie, JSON.stringify({ name: "x".repeat(300_000) })));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
```

Run: `npm test -w @redlance/web -- src/server`
Expected: FAIL.

- [ ] **Step 2: Implement**

`apps/web/src/server/errors.ts`: add the four codes to `ErrorCode` and `STATUS`:

```ts
  | "PAYLOAD_TOO_LARGE"
  | "VERSION_CONFLICT"
  | "STEP_ORDER"
  | "ALREADY_ONBOARDED"
// STATUS:
  PAYLOAD_TOO_LARGE: 413,
  VERSION_CONFLICT: 409,
  STEP_ORDER: 409,
  ALREADY_ONBOARDED: 409,
```

`apps/web/src/server/http.ts` (import `ApiError` from `./errors`):

```ts
const tooLarge = () => new ApiError("PAYLOAD_TOO_LARGE", "That's too much data to send at once.");

/**
 * Reads a request body, refusing anything over `limit` bytes with 413: first by the declared
 * Content-Length (without reading), then by counting the stream (chunked or lying clients).
 */
export async function readBody(request: Request, limit: number): Promise<Buffer> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > limit) throw tooLarge();
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
```

`apps/web/src/server/api-route.ts`: the changes, in order.

```ts
import { clientIp, readBody } from "./http";

export const MAX_JSON_BYTES = 256 * 1024;

type RouteParams = Record<string, string | string[] | undefined>;
/** Next passes `{ params: Promise<…> }` as a route handler's second argument. */
export type RouteHandlerContext = { params?: Promise<RouteParams> };

type Infer<S, Fallback> = S extends z.ZodType ? z.infer<S> : Fallback;

type HandlerContext<I, P, A extends boolean> = {
  request: Request;
  input: I;
  params: P;
  user: A extends true ? Session : Session | null;
  log: Logger;
  requestId: string;
};

type ApiRouteOptions<
  S extends z.ZodType | undefined,
  P extends z.ZodType | undefined,
  A extends boolean,
> = {
  auth?: A;
  input?: S;
  /** Validates the dynamic route segments; a mismatch is a 404. */
  params?: P;
  rateLimit?: RateLimitOption;
  handler: (
    ctx: HandlerContext<Infer<S, undefined>, Infer<P, RouteParams>, A>,
  ) => Promise<Response>;
};

async function parseParams(
  context: RouteHandlerContext | undefined,
  schema: z.ZodType | undefined,
): Promise<unknown> {
  const raw = (await context?.params) ?? {};
  if (!schema) return raw;
  const result = schema.safeParse(raw);
  if (!result.success) throw new ApiError("NOT_FOUND", "Not found.");
  return result.data;
}
```

In `parseInput`, replace the `request.json()` branch:

```ts
  } else {
    const body = await readBody(request, MAX_JSON_BYTES);
    try {
      raw = JSON.parse(body.toString("utf8"));
    } catch {
      throw new ApiError("INVALID_INPUT", "Request body must be valid JSON.");
    }
  }
```

And the wrapper (generic `P` added; order session → origin → params → input → rate limit):

```ts
export function apiRoute<
  S extends z.ZodType | undefined = undefined,
  P extends z.ZodType | undefined = undefined,
  A extends boolean = true,
>(
  options: ApiRouteOptions<S, P, A>,
): (request: Request, context?: RouteHandlerContext) => Promise<Response> {
  return async (request, context) => {
    // … unchanged up to the origin check …
      if (MUTATING.has(request.method)) checkOrigin(request);
      const params = await parseParams(context, options.params);
      const input = options.input
        ? await parseInput(request, url, options.input)
        : undefined;
      await enforceRateLimit(options.rateLimit, user, request);
      response = await options.handler({
        request,
        input,
        params,
        user,
        log,
        requestId,
      } as HandlerContext<Infer<S, undefined>, Infer<P, RouteParams>, A>);
    // … unchanged …
  };
}
```

Update the doc comment to "session → origin → params → input → rate limit".

Run: `npm test -w @redlance/web && npm run typecheck -w @redlance/web`
Expected: PASS. Next's generated route types check each handler's second argument; `RouteHandlerContext` accepts `{ params: Promise<{ step: string }> }`. If `next typegen` complains, widen `RouteParams` to `Record<string, unknown>`; don't cast at the call site.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/server
git commit -m "Let apiRoute validate route params and cap JSON bodies at 256 KB"
```

---

### Task 6: The onboarding service (state and step saves)

**Files:**
- Create: `apps/web/src/server/onboarding/service.ts`, `apps/web/src/server/onboarding/service.test.ts`, `apps/web/test/onboarding-fixtures.ts`

**Interfaces:**
- Consumes: `STEP_SCHEMAS`, `resumeAt`, `pageIndex`, `nextPage`, `toFieldErrors` (core); tables (db); `getDb`, `ApiError`.
- Produces:
  - `type StepRow = { step: StepId; status: StepStatus; data: unknown; version: number; updatedAt: Date }`
  - `getOnboardingState(userId) → { steps: StepRow[]; resumeAt: PageId; onboardedAt: Date | null; trialEndsAt: Date | null }`
  - `saveStep(userId, step, { mode, data, expectedVersion }) → { status, version, next }`
  - `finishOnboarding(userId) → { redirect: "/dashboard" }` (Task 7)

- [ ] **Step 1: Write the failing tests**

`apps/web/test/onboarding-fixtures.ts` (valid data for every step, shared by the service and route tests):

```ts
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
    skills: [{ id: "video-editing", level: "core" }, { id: "premiere-pro", level: "secondary" }],
    customSkills: [{ name: "Descript", level: "secondary" }],
  },
  rates: { minRate: 25, currency: "USD", rateType: "hourly", remoteOnly: true, blockedWords: ["unpaid"] },
} as const;
```

`apps/web/src/server/onboarding/service.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { VALID } from "../../../test/onboarding-fixtures";
import { closeAll, resetState } from "../../../test/helpers";
import { signInDevUser } from "../session";
import { getOnboardingState, saveStep } from "./service";

beforeEach(resetState);
afterAll(closeAll);

const complete = (userId: string, step: keyof typeof VALID, expectedVersion = 0) =>
  saveStep(userId, step, { mode: "complete", data: VALID[step], expectedVersion });

async function user() {
  return (await signInDevUser(`u${Math.random()}@example.com`)).userId;
}

describe("getOnboardingState", () => {
  it("starts empty at the import step", async () => {
    const state = await getOnboardingState(await user());
    expect(state).toMatchObject({ steps: [], resumeAt: "import", onboardedAt: null });
  });
});

describe("saveStep", () => {
  it("completes steps in order and moves resumeAt", async () => {
    const id = await user();
    expect(await complete(id, "import")).toEqual({ status: "completed", version: 1, next: "basics" });
    expect(await complete(id, "basics")).toMatchObject({ next: "skills" });
    expect((await getOnboardingState(id)).resumeAt).toBe("skills");
  });

  it("saves a draft, keeps resumeAt on it, and bumps the version", async () => {
    const id = await user();
    await complete(id, "import");
    const first = await saveStep(id, "basics", { mode: "draft", data: { displayName: "A" }, expectedVersion: 0 });
    expect(first).toEqual({ status: "draft", version: 1, next: "basics" });
    const second = await saveStep(id, "basics", { mode: "draft", data: { displayName: "As" }, expectedVersion: 1 });
    expect(second.version).toBe(2);
    const state = await getOnboardingState(id);
    expect(state.resumeAt).toBe("basics");
    expect(state.steps[1]!.data).toMatchObject({ displayName: "As", categories: [] });
  });

  it("refuses a step after resumeAt (STEP_ORDER), for drafts too", async () => {
    const id = await user();
    await expect(complete(id, "basics")).rejects.toMatchObject({ code: "STEP_ORDER" });
    await expect(
      saveStep(id, "rates", { mode: "draft", data: {}, expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: "STEP_ORDER" });
  });

  it("version conflict: a stale expectedVersion never overwrites", async () => {
    const id = await user();
    await complete(id, "import");
    await saveStep(id, "basics", { mode: "draft", data: { displayName: "Tab A" }, expectedVersion: 0 });
    await expect(
      saveStep(id, "basics", { mode: "draft", data: { displayName: "Tab B" }, expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const results = await Promise.allSettled([
      saveStep(id, "basics", { mode: "draft", data: { displayName: "C" }, expectedVersion: 1 }),
      saveStep(id, "basics", { mode: "draft", data: { displayName: "D" }, expectedVersion: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("never turns a completed step back into a draft", async () => {
    const id = await user();
    await complete(id, "import");
    await complete(id, "basics");
    await expect(
      saveStep(id, "basics", { mode: "draft", data: {}, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("returns field errors prefixed with data.", async () => {
    const id = await user();
    await complete(id, "import");
    const err = await saveStep(id, "basics", {
      mode: "complete",
      data: { ...VALID.basics, displayName: "" },
      expectedVersion: 0,
    }).catch((e) => e);
    expect(err.code).toBe("INVALID_INPUT");
    expect(err.details).toEqual([expect.objectContaining({ path: "data.displayName" })]);
  });
});
```

Run: `npm test -w @redlance/web -- src/server/onboarding`
Expected: FAIL.

- [ ] **Step 2: Implement state and saves**

`apps/web/src/server/onboarding/service.ts`:

```ts
import "server-only";
import {
  STEP_IDS,
  STEP_SCHEMAS,
  nextPage,
  pageIndex,
  resumeAt,
  toFieldErrors,
  type PageId,
  type StepId,
  type StepStatus,
} from "@redlance/core";
import { onboardingSteps, profiles } from "@redlance/db";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { ApiError } from "../errors";

export type StepRow = {
  step: StepId;
  status: StepStatus;
  data: unknown;
  version: number;
  updatedAt: Date;
};

export type OnboardingState = {
  steps: StepRow[];
  resumeAt: PageId;
  onboardedAt: Date | null;
  trialEndsAt: Date | null;
};

export type SaveStepInput = {
  mode: "draft" | "complete";
  data: unknown;
  expectedVersion: number;
};

export type SaveStepResult = { status: StepStatus; version: number; next: PageId };

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const db = getDb();
  const [rows, [profile]] = await Promise.all([
    db
      .select({
        step: onboardingSteps.step,
        status: onboardingSteps.status,
        data: onboardingSteps.data,
        version: onboardingSteps.version,
        updatedAt: onboardingSteps.updatedAt,
      })
      .from(onboardingSteps)
      .where(eq(onboardingSteps.userId, userId)),
    db
      .select({ onboardedAt: profiles.onboardedAt, trialEndsAt: profiles.trialEndsAt })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1),
  ]);
  const steps = STEP_IDS.flatMap((id) => rows.filter((r) => r.step === id));
  return {
    steps,
    resumeAt: resumeAt(steps),
    onboardedAt: profile?.onboardedAt ?? null,
    trialEndsAt: profile?.trialEndsAt ?? null,
  };
}

/**
 * Saves one step. Rules: earlier steps must be completed (STEP_ORDER); a completed step
 * can't go back to draft; `expectedVersion` must match (0 = new row) or VERSION_CONFLICT.
 */
export async function saveStep(
  userId: string,
  step: StepId,
  input: SaveStepInput,
): Promise<SaveStepResult> {
  const state = await getOnboardingState(userId);
  if (state.onboardedAt)
    throw new ApiError("ALREADY_ONBOARDED", "Your profile is already set up.");
  if (pageIndex(step) > pageIndex(state.resumeAt))
    throw new ApiError("STEP_ORDER", "Finish the earlier steps first.", {
      resumeAt: state.resumeAt,
    });
  const current = state.steps.find((s) => s.step === step);
  if (input.mode === "draft" && current?.status === "completed")
    throw new ApiError(
      "INVALID_INPUT",
      "This step is already complete. Use Save changes instead.",
    );

  const parsed = STEP_SCHEMAS[step][input.mode].safeParse(input.data);
  if (!parsed.success)
    throw new ApiError(
      "INVALID_INPUT",
      "Some fields are invalid.",
      toFieldErrors(parsed.error, "data"),
    );

  const status: StepStatus = input.mode === "complete" ? "completed" : "draft";
  const db = getDb();
  const rows =
    input.expectedVersion === 0
      ? await db
          .insert(onboardingSteps)
          .values({ userId, step, status, data: parsed.data })
          .onConflictDoNothing()
          .returning({ version: onboardingSteps.version })
      : await db
          .update(onboardingSteps)
          .set({
            status,
            data: parsed.data,
            version: sql`${onboardingSteps.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(onboardingSteps.userId, userId),
              eq(onboardingSteps.step, step),
              eq(onboardingSteps.version, input.expectedVersion),
            ),
          )
          .returning({ version: onboardingSteps.version });

  const saved = rows[0];
  if (!saved)
    throw new ApiError(
      "VERSION_CONFLICT",
      "This step was saved in another tab. Reload to see the latest version.",
    );
  return { status, version: saved.version, next: status === "completed" ? nextPage(step) : step };
}
```

Run: `npm test -w @redlance/web -- src/server/onboarding`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/server/onboarding
git commit -m "Add the onboarding service: state, step saves with order and version checks"
```

---

### Task 7: Finish

**Files:**
- Modify: `apps/web/src/server/onboarding/service.ts`, `apps/web/src/server/onboarding/service.test.ts`

**Interfaces:**
- Produces: `finishOnboarding(userId) → { redirect: "/dashboard" }`. It writes `profiles`, `profile_skills`, `custom_skills`, `user_subreddits` (auto) and `alert_channels` (email), then sets `onboarded_at` and `trial_ends_at = onboarded_at + TRIAL_DAYS`.

- [ ] **Step 1: Write the failing tests**

Append to `service.test.ts` (extend the imports: `finishOnboarding`, `getDb`, and the tables from `@redlance/db`, `eq` from `drizzle-orm`, `subredditsFor` from `@redlance/core`):

```ts
async function completeAll(id: string) {
  for (const step of ["import", "basics", "skills", "rates"] as const)
    await complete(id, step);
}

describe("finishOnboarding", () => {
  it("refuses while a step is missing or a draft", async () => {
    const id = await user();
    await complete(id, "import");
    await expect(finishOnboarding(id)).rejects.toMatchObject({
      code: "STEP_ORDER",
      details: { resumeAt: "basics" },
    });
  });

  it("writes the profile and every child table, and starts a 5-day trial", async () => {
    const id = await user();
    await completeAll(id);
    expect(await finishOnboarding(id)).toEqual({ redirect: "/dashboard" });

    const db = getDb();
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, id));
    expect(profile).toMatchObject({
      displayName: "Asha",
      categories: ["video"],
      githubUsername: "asha-edits",
      minRateMinor: 2500,
      currency: "USD",
      remoteOnly: true,
      blockedWords: ["unpaid"],
    });
    expect(profile!.trialEndsAt.getTime() - profile!.onboardedAt.getTime()).toBe(5 * 86_400_000);

    const skillRows = await db.select().from(profileSkills).where(eq(profileSkills.userId, id));
    expect(skillRows.map((s) => [s.skillId, s.level, s.source]).sort()).toEqual([
      ["premiere-pro", "secondary", "manual"],
      ["video-editing", "core", "manual"],
    ]);
    const [custom] = await db.select().from(customSkills).where(eq(customSkills.userId, id));
    expect(custom).toMatchObject({ name: "Descript", nameNormalized: "descript" });

    const subs = await db.select().from(userSubreddits).where(eq(userSubreddits.userId, id));
    expect(subs.map((s) => s.subreddit).sort()).toEqual([...subredditsFor(["video"])].sort());
    expect(subs.every((s) => s.source === "auto")).toBe(true);

    const [alert] = await db.select().from(alertChannels).where(eq(alertChannels.userId, id));
    expect(alert).toMatchObject({ kind: "email", enabled: true });

    expect((await getOnboardingState(id)).onboardedAt).toEqual(profile!.onboardedAt);
  });

  it("is idempotent under concurrency and never restarts the trial", async () => {
    const id = await user();
    await completeAll(id);
    await Promise.all([finishOnboarding(id), finishOnboarding(id), finishOnboarding(id)]);
    const [first] = await getDb().select().from(profiles).where(eq(profiles.userId, id));
    await finishOnboarding(id);
    const rows = await getDb().select().from(profiles).where(eq(profiles.userId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trialEndsAt).toEqual(first!.trialEndsAt);
  });

  it("blocks step saves after finishing", async () => {
    const id = await user();
    await completeAll(id);
    await finishOnboarding(id);
    await expect(complete(id, "rates", 1)).rejects.toMatchObject({ code: "ALREADY_ONBOARDED" });
  });
});
```

Run: `npm test -w @redlance/web -- src/server/onboarding`
Expected: FAIL (`finishOnboarding` missing).

- [ ] **Step 2: Implement**

Add to `service.ts` (extend imports: `TRIAL_DAYS`, `normalizeSkillName`, `subredditsFor`, `type StepData` from core; `alertChannels`, `customSkills`, `profileSkills`, `userSubreddits`, `users` from db):

```ts
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function completedSteps(tx: Tx, userId: string) {
  const rows = await tx
    .select({ step: onboardingSteps.step, status: onboardingSteps.status, data: onboardingSteps.data })
    .from(onboardingSteps)
    .where(eq(onboardingSteps.userId, userId));

  function read<S extends StepId>(step: S): StepData<S> {
    const row = rows.find((r) => r.step === step);
    const parsed =
      row?.status === "completed" ? STEP_SCHEMAS[step].complete.safeParse(row.data) : undefined;
    // A saved step that no longer passes (e.g. a tightened limit) sends the user back to it.
    if (!parsed?.success)
      throw new ApiError("STEP_ORDER", "Finish every step first.", { resumeAt: step });
    return parsed.data as StepData<S>;
  }

  return {
    basics: read("basics"),
    skills: read("skills"),
    rates: read("rates"),
    imported: read("import"),
  };
}

/**
 * Turns the saved steps into the profile, in one transaction. The user row lock makes a
 * double click wait for the first call, which then finds the profile and returns: the
 * trial starts exactly once.
 */
export async function finishOnboarding(userId: string): Promise<{ redirect: string }> {
  return getDb().transaction(async (tx) => {
    const [user] = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) throw new ApiError("UNAUTHENTICATED", "Please sign in.");

    const [existing] = await tx
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(eq(profiles.userId, userId));
    if (existing) return { redirect: "/dashboard" };

    const { basics, skills, rates, imported } = await completedSteps(tx, userId);

    await tx.insert(profiles).values({
      userId,
      displayName: basics.displayName,
      headline: basics.headline,
      categories: basics.categories,
      experienceLevel: basics.experienceLevel,
      country: basics.country,
      timeZone: basics.timeZone,
      githubUsername: imported.githubUsername,
      minRateMinor: Math.round(rates.minRate * 100),
      currency: rates.currency,
      rateType: rates.rateType,
      remoteOnly: rates.remoteOnly,
      blockedWords: rates.blockedWords,
      onboardedAt: sql`now()`,
      trialEndsAt: sql`now() + make_interval(days => ${TRIAL_DAYS})`,
    });

    if (skills.skills.length)
      await tx.insert(profileSkills).values(
        skills.skills.map((s) => ({ userId, skillId: s.id, level: s.level, source: s.source })),
      );
    if (skills.customSkills.length)
      await tx.insert(customSkills).values(
        skills.customSkills.map((s) => ({
          userId,
          name: s.name,
          nameNormalized: normalizeSkillName(s.name),
          level: s.level,
          source: s.source,
        })),
      );

    const boards = subredditsFor(basics.categories);
    if (boards.length)
      await tx
        .insert(userSubreddits)
        .values(boards.map((subreddit) => ({ userId, subreddit, source: "auto" as const })))
        .onConflictDoNothing();

    // The sign-in email is verified by the auth provider (Cognito's one-time code later;
    // dev sessions exist only locally).
    await tx
      .insert(alertChannels)
      .values({ userId, kind: "email", target: user.email, verifiedAt: sql`now()` })
      .onConflictDoNothing();

    return { redirect: "/dashboard" };
  });
}
```

Notes:
- `now()` is the transaction start time, so `trial_ends_at − onboarded_at` is exactly 5 days (the test pins it).
- `getOnboardingState` runs outside the transaction on purpose; Finish re-reads everything inside it.

Run: `npm test -w @redlance/web -- src/server/onboarding && npm run typecheck -w @redlance/web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/server/onboarding
git commit -m "Add Finish: write the profile, auto-connect subreddits, email alerts, start the trial once"
```

---

### Task 8: The three onboarding routes

**Files:**
- Create: `apps/web/src/app/api/v1/onboarding/route.ts`, `apps/web/src/app/api/v1/onboarding/steps/[step]/route.ts`, `apps/web/src/app/api/v1/onboarding/finish/route.ts`, `apps/web/src/app/api/v1/onboarding/onboarding.test.ts`

**Interfaces:**
- `GET /api/v1/onboarding` → `{ steps: [{ id, status, data, version, updatedAt }], resumeAt, onboardedAt }` (slice 2 adds `imports`).
- `PUT /api/v1/onboarding/steps/:step` body `{ mode, data, expectedVersion }` → `{ status, version, next }`.
- `POST /api/v1/onboarding/finish` → `{ redirect }`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/app/api/v1/onboarding/onboarding.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, cookieFor, req, resetState } from "../../../../../test/helpers";
import { TEST_ENV } from "../../../../../test/test-env";
import { VALID } from "../../../../../test/onboarding-fixtures";
import { POST as finish } from "./finish/route";
import { GET as getState } from "./route";
import { PUT as putStep } from "./steps/[step]/route";

beforeEach(resetState);
afterAll(closeAll);

const put = (cookie: string, step: string, body: unknown) =>
  putStep(
    req(`/api/v1/onboarding/steps/${step}`, {
      method: "PUT",
      headers: { cookie, origin: TEST_ENV.APP_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ step }) },
  );

describe("onboarding routes", () => {
  it("401s without a session", async () => {
    expect((await getState(req("/api/v1/onboarding"))).status).toBe(401);
  });

  it("GET returns the empty state", async () => {
    const cookie = await cookieFor();
    const res = await getState(req("/api/v1/onboarding", { headers: { cookie } }));
    expect(await res.json()).toEqual({ steps: [], resumeAt: "import", onboardedAt: null });
  });

  it("PUT saves a step and GET shows it", async () => {
    const cookie = await cookieFor();
    const res = await put(cookie, "import", { mode: "complete", data: VALID.import, expectedVersion: 0 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "completed", version: 1, next: "basics" });
    const state = await (await getState(req("/api/v1/onboarding", { headers: { cookie } }))).json();
    expect(state.steps[0]).toMatchObject({ id: "import", status: "completed", version: 1 });
    expect(state.resumeAt).toBe("basics");
  });

  it("maps service errors to status codes", async () => {
    const cookie = await cookieFor();
    expect((await put(cookie, "rates", { mode: "draft", data: {}, expectedVersion: 0 })).status).toBe(409);
    expect((await put(cookie, "voice", { mode: "draft", data: {}, expectedVersion: 0 })).status).toBe(404);
    expect((await put(cookie, "import", { mode: "maybe", data: {}, expectedVersion: 0 })).status).toBe(400);
    expect((await put(cookie, "import", { mode: "draft", expectedVersion: 0 })).status).toBe(400);
    const bad = await put(cookie, "import", { mode: "complete", data: { githubUsername: "not a name!" }, expectedVersion: 0 });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.details[0].path).toBe("data.githubUsername");
  });

  it("refuses a PUT without an allowed Origin", async () => {
    const cookie = await cookieFor();
    const res = await putStep(
      req("/api/v1/onboarding/steps/import", {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ mode: "complete", data: VALID.import, expectedVersion: 0 }),
      }),
      { params: Promise.resolve({ step: "import" }) },
    );
    expect(res.status).toBe(403);
  });

  it("POST finish works once every step is completed", async () => {
    const cookie = await cookieFor();
    const post = () =>
      finish(req("/api/v1/onboarding/finish", { method: "POST", headers: { cookie, origin: TEST_ENV.APP_ORIGIN } }));
    expect((await post()).status).toBe(409);
    for (const step of ["import", "basics", "skills", "rates"] as const)
      await put(cookie, step, { mode: "complete", data: VALID[step], expectedVersion: 0 });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirect: "/dashboard" });
  });
});
```

Run: `npm test -w @redlance/web -- src/app/api/v1/onboarding`
Expected: FAIL.

- [ ] **Step 2: Implement the routes**

`apps/web/src/app/api/v1/onboarding/route.ts`:

```ts
import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";
import { getOnboardingState } from "@/server/onboarding/service";

export const GET = apiRoute({
  handler: async ({ user }) => {
    const state = await getOnboardingState(user.userId);
    return json(200, {
      steps: state.steps.map(({ step, ...rest }) => ({ id: step, ...rest })),
      resumeAt: state.resumeAt,
      onboardedAt: state.onboardedAt,
    });
  },
});
```

`apps/web/src/app/api/v1/onboarding/steps/[step]/route.ts`:

```ts
import { STEP_IDS } from "@redlance/core";
import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";
import { saveStep } from "@/server/onboarding/service";

export const PUT = apiRoute({
  params: z.object({ step: z.enum(STEP_IDS) }),
  input: z.object({
    mode: z.enum(["draft", "complete"]),
    data: z.unknown(),
    expectedVersion: z.number().int().min(0).max(1_000_000),
  }),
  handler: async ({ user, params, input }) =>
    json(200, await saveStep(user.userId, params.step, input)),
});
```

`apps/web/src/app/api/v1/onboarding/finish/route.ts`:

```ts
import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";
import { finishOnboarding } from "@/server/onboarding/service";

export const POST = apiRoute({
  handler: async ({ user }) => json(200, await finishOnboarding(user.userId)),
});
```

Run: `npm test -w @redlance/web && npm run typecheck -w @redlance/web && npm run lint -w @redlance/web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/v1/onboarding apps/web/test apps/web/src/server/onboarding
git commit -m "Add the onboarding API: state, step saves and finish"
```

---

### Task 9: Onboarding pages: protection, layout, redirects and progress

**Files:**
- Modify: `apps/web/src/proxy.ts`, `apps/web/src/proxy.test.ts`
- Create: `apps/web/src/server/onboarding/page-data.ts`, `apps/web/src/server/onboarding/page-data.test.ts`, `apps/web/src/components/onboarding/step-form-types.ts`, `apps/web/src/app/(onboarding)/layout.tsx`, `apps/web/src/app/(onboarding)/onboarding/page.tsx`, `apps/web/src/app/(onboarding)/onboarding/[step]/page.tsx`, `apps/web/src/components/onboarding/progress.tsx`, `apps/web/src/components/onboarding/step-header.tsx`

**Interfaces:**
- Produces:
  - `loadOnboardingPage(path) → { user, state }`: redirects signed-out users to `/login?next=…` and onboarded users to `/dashboard`.
  - `stepInit(state, userId, step) → StepFormInit<S>`: saved data parsed with the draft schema, or defaults. New Rates rows default the currency from the Basics country.
  - `savedDraft(state, step)`, `reviewData(state) → { ok: true, data } | { ok: false, step }`
  - `StepFormInit<S> = { userId, step, status, version, data, resumeAt }` in `components/onboarding/step-form-types.ts` (type only, so server code can import it; the hook re-exports it in Task 10)

- [ ] **Step 1: Protect `/onboarding` in the proxy (test first)**

Add to `apps/web/src/proxy.test.ts`:

```ts
  it("protects onboarding pages too", () => {
    const res = proxy(request("/onboarding/skills"));
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/onboarding/skills");
  });
```

This test passes already (the function doesn't look at the path); the matcher is what limits it. Change it anyway, and check that it applies by opening `/onboarding` signed out in Step 6:

```ts
export const config = {
  matcher: ["/dashboard/:path*", "/onboarding/:path*"],
};
```

- [ ] **Step 2: Write the failing page-data tests**

`apps/web/src/server/onboarding/page-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { VALID } from "../../../test/onboarding-fixtures";
import { reviewData, stepInit } from "./page-data";
import type { OnboardingState } from "./service";

const row = (step: string, data: unknown, status: "draft" | "completed" = "completed", version = 1) => ({
  step, status, data, version, updatedAt: new Date(),
}) as OnboardingState["steps"][number];

const state = (steps: OnboardingState["steps"], resumeAt: OnboardingState["resumeAt"] = "import"): OnboardingState => ({
  steps, resumeAt, onboardedAt: null, trialEndsAt: null,
});

describe("stepInit", () => {
  it("returns the saved data, status and version", () => {
    const init = stepInit(state([row("basics", VALID.basics, "draft", 3)]), "u1", "basics");
    expect(init).toMatchObject({ userId: "u1", step: "basics", status: "draft", version: 3 });
    expect(init.data.displayName).toBe("Asha");
  });

  it("starts new rates in the Basics country's currency", () => {
    const s = state([row("basics", { ...VALID.basics, country: "GB" })]);
    expect(stepInit(s, "u1", "rates").data.currency).toBe("GBP");
    expect(stepInit(s, "u1", "rates").version).toBe(0);
  });

  it("falls back to an empty draft (keeping the version) when saved data no longer parses", () => {
    const init = stepInit(state([row("basics", { displayName: 42 }, "draft", 2)]), "u1", "basics");
    expect(init.data.displayName).toBe("");
    expect(init.version).toBe(2);
  });
});

describe("reviewData", () => {
  it("parses every step with its complete schema", () => {
    const steps = (["import", "basics", "skills", "rates"] as const).map((s) => row(s, VALID[s]));
    const result = reviewData(state(steps, "review"));
    expect(result.ok && result.data.rates.minRate).toBe(25);
  });

  it("points at the first step that no longer passes", () => {
    const steps = (["import", "basics", "skills", "rates"] as const).map((s) =>
      row(s, s === "skills" ? { skills: [] } : VALID[s]),
    );
    expect(reviewData(state(steps, "review"))).toEqual({ ok: false, step: "skills" });
  });
});
```

Run: `npm test -w @redlance/web -- src/server/onboarding/page-data`
Expected: FAIL.

- [ ] **Step 3: Implement page data**

First create the type-only piece of the hook module, so server code can import the type now: `apps/web/src/components/onboarding/step-form-types.ts`:

```ts
import type { PageId, StepDraft, StepId, StepStatus } from "@redlance/core";

/** What a step page hands its client form. */
export type StepFormInit<S extends StepId> = {
  userId: string;
  step: S;
  status: StepStatus | null;
  version: number;
  data: StepDraft<S>;
  resumeAt: PageId;
};
```

`apps/web/src/server/onboarding/page-data.ts`:

```ts
import "server-only";
import {
  STEP_IDS,
  STEP_SCHEMAS,
  defaultCurrency,
  emptyDraft,
  type StepData,
  type StepDraft,
  type StepId,
} from "@redlance/core";
import { redirect } from "next/navigation";
import type { StepFormInit } from "@/components/onboarding/step-form-types";
import { getCurrentUser } from "../current-user";
import { getOnboardingState, type OnboardingState } from "./service";

/** Guards every onboarding page (layouts don't re-render on client navigation, so pages do it). */
export async function loadOnboardingPage(path: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  const state = await getOnboardingState(user.userId);
  if (state.onboardedAt) redirect("/dashboard");
  return { user, state };
}

export function savedDraft<S extends StepId>(state: OnboardingState, step: S): StepDraft<S> | null {
  const row = state.steps.find((r) => r.step === step);
  const parsed = row ? STEP_SCHEMAS[step].draft.safeParse(row.data) : undefined;
  return parsed?.success ? (parsed.data as StepDraft<S>) : null;
}

function defaultsFor<S extends StepId>(step: S, state: OnboardingState): StepDraft<S> {
  const empty = emptyDraft(step);
  if (step === "rates")
    return {
      ...(empty as StepDraft<"rates">),
      currency: defaultCurrency(savedDraft(state, "basics")?.country ?? null),
    } as StepDraft<S>;
  return empty;
}

export function stepInit<S extends StepId>(
  state: OnboardingState,
  userId: string,
  step: S,
): StepFormInit<S> {
  const row = state.steps.find((r) => r.step === step);
  return {
    userId,
    step,
    status: row?.status ?? null,
    version: row?.version ?? 0,
    data: row ? (savedDraft(state, step) ?? emptyDraft(step)) : defaultsFor(step, state),
    resumeAt: state.resumeAt,
  };
}

export type ReviewData = { [S in StepId]: StepData<S> };

export function reviewData(
  state: OnboardingState,
): { ok: true; data: ReviewData } | { ok: false; step: StepId } {
  const out: Partial<Record<StepId, unknown>> = {};
  for (const step of STEP_IDS) {
    const row = state.steps.find((r) => r.step === step);
    const parsed = row?.status === "completed" ? STEP_SCHEMAS[step].complete.safeParse(row.data) : undefined;
    if (!parsed?.success) return { ok: false, step };
    out[step] = parsed.data;
  }
  return { ok: true, data: out as ReviewData };
}
```

Run: `npm test -w @redlance/web -- src/server/onboarding/page-data`
Expected: PASS.

- [ ] **Step 4: Layout, index redirect, progress and header**

`apps/web/src/app/(onboarding)/layout.tsx` (focused chrome; no sidebar; the auth check lives in each page):

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/app/sign-out-button";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = {
  title: "Set up your profile",
  robots: { index: false, follow: false },
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 flex-col bg-cream">
      <header className="flex items-center justify-between px-4 py-4 sm:px-10 sm:py-5">
        <Link
          href="/dashboard"
          aria-label="Redlance dashboard"
          className="inline-flex rounded-md text-2xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Logo />
        </Link>
        <SignOutButton />
      </header>
      <main id="main" className="flex flex-1 justify-center px-4 pt-2 pb-16 sm:pt-6">
        {children}
      </main>
    </div>
  );
}
```

`apps/web/src/app/(onboarding)/onboarding/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { loadOnboardingPage } from "@/server/onboarding/page-data";

export default async function OnboardingIndexPage() {
  const { state } = await loadOnboardingPage("/onboarding");
  redirect(`/onboarding/${state.resumeAt}`);
}
```

`apps/web/src/components/onboarding/progress.tsx`:

```tsx
import { PAGE_IDS, PAGE_TITLES, canOpen, pageIndex, type PageId } from "@redlance/core";
import { cn } from "cn";
import Link from "next/link";

export function Progress({ current, resumeAt }: { current: PageId; resumeAt: PageId }) {
  const index = pageIndex(current);
  return (
    <nav aria-label="Setup progress" className="mb-6">
      <p className="text-sm font-medium text-stone">
        Step {index + 1} of {PAGE_IDS.length}
        <span className="text-muted-foreground"> · {PAGE_TITLES[current]}</span>
      </p>
      <ol className="mt-3 flex gap-1.5">
        {PAGE_IDS.map((page, i) => {
          const bar = (
            <span
              aria-hidden="true"
              className={cn("block h-1.5 rounded-full", i <= index ? "bg-ink" : "bg-feed")}
            />
          );
          const label = <span className="mt-2 hidden text-xs text-muted-foreground sm:block">{PAGE_TITLES[page]}</span>;
          return (
            <li key={page} className="flex-1">
              {page !== current && canOpen(page, resumeAt) ? (
                <Link href={`/onboarding/${page}`} className="block rounded py-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                  {bar}
                  {label}
                  <span className="sr-only sm:hidden">{PAGE_TITLES[page]}</span>
                </Link>
              ) : (
                <span className="block py-2" aria-current={page === current ? "step" : undefined}>
                  {bar}
                  {label}
                  <span className="sr-only sm:hidden">{PAGE_TITLES[page]}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

`apps/web/src/components/onboarding/step-header.tsx`:

```tsx
export function StepHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
      <p className="mt-2 max-w-xl text-sm text-stone">{description}</p>
    </header>
  );
}
```

- [ ] **Step 5: The step page (forms arrive in Tasks 10–12)**

`apps/web/src/app/(onboarding)/onboarding/[step]/page.tsx`:

```tsx
import { PAGE_TITLES, canOpen, isPageId } from "@redlance/core";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Progress } from "@/components/onboarding/progress";
import { loadOnboardingPage } from "@/server/onboarding/page-data";

export async function generateMetadata(props: PageProps<"/onboarding/[step]">): Promise<Metadata> {
  const { step } = await props.params;
  return { title: isPageId(step) ? `${PAGE_TITLES[step]} · Set up your profile` : "Set up your profile" };
}

export default async function OnboardingStepPage(props: PageProps<"/onboarding/[step]">) {
  const { step } = await props.params;
  if (!isPageId(step)) notFound();
  const { user, state } = await loadOnboardingPage(`/onboarding/${step}`);
  if (!canOpen(step, state.resumeAt)) redirect(`/onboarding/${state.resumeAt}`);

  return (
    <div className="w-full max-w-2xl">
      <Progress current={step} resumeAt={state.resumeAt} />
      <div className="rounded-2xl border border-border bg-background p-5 shadow-xs sm:p-8">
        {/* Task 10–12 replace this with the step forms. */}
        <p className="text-sm text-muted-foreground">{PAGE_TITLES[step]} for {user.email}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Check it in the browser**

```bash
npm run typecheck -w @redlance/web && npm run lint -w @redlance/web
npm run dev
```

Check, signed out and then signed in (`/login`, any email):
- `/onboarding` signed out → `/login?next=%2Fonboarding` (proxy) → after sign-in lands on `/onboarding/import`.
- `/onboarding/rates` for a new user → redirects to `/onboarding/import`.
- `/onboarding/nope` → 404.
- Progress shows "Step 1 of 5 · Import"; later bars aren't links.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "Add the onboarding route group: guards, redirects and the progress bar"
```

---

### Task 10: The step form hook, shared pieces, Import and Basics

**Files:**
- Create: `apps/web/src/components/onboarding/local-copy.ts`, `apps/web/src/components/onboarding/local-copy.test.ts`, `apps/web/src/components/onboarding/use-step-form.ts`, `apps/web/src/components/onboarding/step-actions.tsx`, `apps/web/src/components/onboarding/field.tsx`, `apps/web/src/components/onboarding/browser-intl.ts`, `apps/web/src/components/onboarding/import-step.tsx`, `apps/web/src/components/onboarding/basics-step.tsx`, `apps/web/src/components/ui/{textarea,alert-dialog}.tsx` (shadcn)
- Modify: `apps/web/src/app/(onboarding)/onboarding/[step]/page.tsx`

**Interfaces:**
- Produces: `useStepForm(init, { prepare? })` returning:
  - state: `value`, `setValue`, `update(patch)`, `errorFor(path)`, `pending`, `notice`, `dirty`, `completed`, `restorable`
  - actions: `next()`, `saveDraft() → Promise<boolean>`, `discard()`, `restore()`, `dismissRestore()`
- Also `<StepActions>`, `<RestoreBanner>`, `<Field>`.

- [ ] **Step 1: Add the shadcn pieces**

```bash
npx shadcn@latest add textarea alert-dialog -c apps/web
```

Read the generated `alert-dialog.tsx` and use its exported names below; they're Base UI based, so `open` / `onOpenChange` on the root.

- [ ] **Step 2: Test the local-copy rules (pure)**

`apps/web/src/components/onboarding/local-copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseLocalCopy } from "./local-copy";

const init = { step: "basics" as const, version: 2, data: { displayName: "Asha" } };
const copy = (version: number, data: unknown) => JSON.stringify({ version, data });

describe("parseLocalCopy", () => {
  it("offers a copy made from the same server version that differs from it", () => {
    expect(parseLocalCopy(copy(2, { displayName: "Asha K" }), init)?.displayName).toBe("Asha K");
  });

  it("ignores copies from another version, identical copies, invalid data and junk", () => {
    expect(parseLocalCopy(copy(1, { displayName: "Old" }), init)).toBeNull();
    expect(parseLocalCopy(copy(2, { displayName: "Asha" }), { ...init, data: { ...init.data } })).toBeNull();
    expect(parseLocalCopy(copy(2, { displayName: 5 }), init)).toBeNull();
    expect(parseLocalCopy("{not json", init)).toBeNull();
    expect(parseLocalCopy(null, init)).toBeNull();
  });
});
```

The identical-copy case compares after draft parsing (defaults filled), so compare `init.data` through the same parse. Implement:

`apps/web/src/components/onboarding/local-copy.ts`:

```ts
import { STEP_SCHEMAS, type StepDraft, type StepId } from "@redlance/core";

export const localCopyKey = (userId: string, step: StepId) => `rl:onb:${userId}:${step}`;

export const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A copy of unsaved form values kept in this browser. Offered back only when it was made from
 * the version the server still has, and differs from it.
 */
export function parseLocalCopy<S extends StepId>(
  raw: string | null,
  init: { step: S; version: number; data: unknown },
): StepDraft<S> | null {
  if (!raw) return null;
  try {
    const copy = JSON.parse(raw) as { version?: unknown; data?: unknown };
    if (copy.version !== init.version) return null;
    const schema = STEP_SCHEMAS[init.step].draft;
    const local = schema.safeParse(copy.data);
    const server = schema.safeParse(init.data);
    if (!local.success) return null;
    if (server.success && sameJson(local.data, server.data)) return null;
    return local.data as StepDraft<S>;
  } catch {
    return null;
  }
}

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, version: number, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ version, data }));
  } catch {
    // Storage full or blocked (private mode): the safety net is best-effort.
  }
}

export function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Same as above.
  }
}
```

Run: `npm test -w @redlance/web -- src/components/onboarding`
Expected: PASS after implementing.

- [ ] **Step 3: The hook**

`apps/web/src/components/onboarding/use-step-form.ts`:

```ts
"use client";

import {
  STEP_SCHEMAS,
  toFieldErrors,
  type FieldError,
  type PageId,
  type StepDraft,
  type StepId,
  type StepStatus,
} from "@redlance/core";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  localCopyKey,
  parseLocalCopy,
  readLocal,
  removeLocal,
  sameJson,
  writeLocal,
} from "./local-copy";
import type { StepFormInit } from "./step-form-types";

export type { StepFormInit } from "./step-form-types";

type Notice = { kind: "saved" } | { kind: "conflict" } | { kind: "error"; message: string };
type SaveResult = { status: StepStatus; version: number; next: PageId };
type ErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

// The local copy as it was when the form mounted; this tab's own later writes don't count.
// Module-level so the render stays pure (useSyncExternalStore calls this during render).
const firstRead = new Map<string, string | null>();
const noopSubscribe = () => () => {};
const mountSnapshot = (key: string) => () => {
  if (!firstRead.has(key)) firstRead.set(key, readLocal(key));
  return firstRead.get(key) ?? null;
};
const serverSnapshot = () => null;

function focusFirstInvalid() {
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  );
}

export function useStepForm<S extends StepId>(
  init: StepFormInit<S>,
  options: { prepare?: (value: StepDraft<S>) => StepDraft<S> } = {},
) {
  const router = useRouter();
  const key = localCopyKey(init.userId, init.step);
  const [value, setValue] = useState(init.data);
  const [saved, setSaved] = useState({ data: init.data, version: init.version, status: init.status });
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [pending, setPending] = useState<"draft" | "complete" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [restoreHandled, setRestoreHandled] = useState(false);

  const dirty = !sameJson(value, saved.data);
  const localRaw = useSyncExternalStore(noopSubscribe, mountSnapshot(key), serverSnapshot);
  const restorable = restoreHandled ? null : parseLocalCopy(localRaw, init);

  useEffect(() => () => void firstRead.delete(key), [key]);

  // Safety net: unsaved values go to localStorage (never the server), 400 ms after typing stops.
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => writeLocal(key, saved.version, value), 400);
    return () => clearTimeout(timer);
  }, [key, dirty, value, saved.version]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function handleError(body: ErrorBody) {
    const code = body.error?.code;
    if (code === "VERSION_CONFLICT") setNotice({ kind: "conflict" });
    else if (code === "STEP_ORDER" || code === "ALREADY_ONBOARDED") router.refresh();
    else if (code === "INVALID_INPUT" && Array.isArray(body.error?.details)) {
      setErrors(
        (body.error.details as FieldError[]).map((e) => ({ ...e, path: e.path.replace(/^data\.?/, "") })),
      );
      focusFirstInvalid();
    } else
      setNotice({ kind: "error", message: body.error?.message ?? "Couldn't save. Please try again." });
  }

  async function save(mode: "draft" | "complete"): Promise<SaveResult | null> {
    if (pending) return null;
    const prepared = options.prepare ? options.prepare(value) : value;
    const checked = STEP_SCHEMAS[init.step][mode].safeParse(prepared);
    setNotice(null);
    if (!checked.success) {
      setErrors(toFieldErrors(checked.error));
      focusFirstInvalid();
      return null;
    }
    setErrors([]);
    setPending(mode);
    try {
      const res = await fetch(`/api/v1/onboarding/steps/${init.step}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, data: checked.data, expectedVersion: saved.version }),
      });
      const body = (await res.json().catch(() => ({}))) as SaveResult & ErrorBody;
      if (!res.ok) {
        handleError(body);
        return null;
      }
      const data = checked.data as StepDraft<S>;
      removeLocal(key);
      setSaved({ data, version: body.version, status: body.status });
      setValue(data);
      return body;
    } catch {
      setNotice({ kind: "error", message: "Can't reach Redlance. Check your connection and try again." });
      return null;
    } finally {
      setPending(null);
    }
  }

  const completed = saved.status === "completed";

  return {
    step: init.step,
    resumeAt: init.resumeAt,
    value,
    setValue,
    update: (patch: Partial<StepDraft<S>>) => setValue((v) => ({ ...v, ...patch }) as StepDraft<S>),
    errorFor: (path: string) => errors.find((e) => e.path === path)?.message,
    pending,
    notice,
    dirty,
    completed,
    restorable,
    restore() {
      if (restorable) setValue(restorable);
      setRestoreHandled(true);
    },
    dismissRestore() {
      removeLocal(key);
      setRestoreHandled(true);
    },
    discard() {
      removeLocal(key);
      setValue(saved.data);
    },
    async next() {
      const result = await save("complete");
      if (result) router.push(`/onboarding/${result.next}`);
    },
    /** "Save draft", or "Save changes" on a completed step (full validation, stays completed). */
    async saveDraft(): Promise<boolean> {
      const result = await save(completed ? "complete" : "draft");
      if (result) setNotice({ kind: "saved" });
      return result !== null;
    },
  };
}

export type StepForm = ReturnType<typeof useStepForm>;
```

If `react-hooks` lint flags `mountSnapshot(key)` (a new function each render) or the `firstRead` cleanup, keep the behaviour and restructure. Don't disable the rule. The mount-time read must not re-run on every render: once the user types, the tab's own writes would make the restore banner flash.

- [ ] **Step 4: Shared UI**

`apps/web/src/components/onboarding/field.tsx`:

```tsx
import { Label } from "@/components/ui/label";

export const errorId = (id: string) => `${id}-error`;
export const hintId = (id: string) => `${id}-hint`;

/** aria props for a control: invalid state + described by its hint or error. */
export function controlProps(id: string, error?: string, hint?: string) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId(id) : hint ? hintId(id) : undefined,
  } as const;
}

export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </Label>
      {children}
      {error ? (
        <p id={errorId(id)} className="text-sm text-danger">{error}</p>
      ) : hint ? (
        <p id={hintId(id)} className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** For groups (chips, radios): a fieldset with a legend instead of a label. */
export function FieldGroup({
  legend,
  hint,
  error,
  errorKey,
  children,
}: {
  legend: string;
  hint?: string;
  error?: string;
  errorKey: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-2" aria-describedby={error ? errorId(errorKey) : undefined}>
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
      {error && <p id={errorId(errorKey)} className="text-sm text-danger">{error}</p>}
    </fieldset>
  );
}
```

`apps/web/src/components/onboarding/step-actions.tsx`:

```tsx
"use client";

import type { PageId } from "@redlance/core";
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { StepForm } from "./use-step-form";

export function RestoreBanner({ form }: { form: StepForm }) {
  if (!form.restorable) return null;
  return (
    <div role="status" className="mb-6 flex flex-col gap-3 rounded-xl border border-flare-100 bg-flare-50 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p>You have unsaved changes on this step from earlier.</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={form.restore}>Restore them</Button>
        <Button size="sm" variant="ghost" onClick={form.dismissRestore}>Dismiss</Button>
      </div>
    </div>
  );
}

export function StepActions({
  form,
  back,
  nextLabel = "Next",
  showDraft = true,
}: {
  form: StepForm;
  back: PageId | null;
  nextLabel?: string;
  showDraft?: boolean;
}) {
  const router = useRouter();
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  function go(href: string) {
    if (form.dirty) setLeaveTo(href);
    else router.push(href);
  }

  return (
    <>
      <div aria-live="polite" className="mt-6 min-h-5 text-sm">
        {form.notice?.kind === "saved" && <p className="text-success">Draft saved.</p>}
        {form.notice?.kind === "error" && <p role="alert" className="text-danger">{form.notice.message}</p>}
        {form.notice?.kind === "conflict" && (
          <p role="alert" className="text-danger">
            This step was saved in another tab.{" "}
            <button type="button" className="underline" onClick={() => window.location.reload()}>
              Reload to see the latest version
            </button>
            .
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {back && (
            <Button variant="ghost" size="lg" onClick={() => go(`/onboarding/${back}`)}>
              <ArrowLeft aria-hidden="true" /> Back
            </Button>
          )}
          {form.resumeAt === "review" && (
            <Button variant="ghost" size="lg" onClick={() => go("/onboarding/review")}>
              Back to review
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          {showDraft && (
            <Button variant="outline" size="lg" onClick={form.saveDraft} disabled={!!form.pending || !form.dirty}>
              {form.pending === "draft" && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              {form.completed ? "Save changes" : "Save draft"}
            </Button>
          )}
          <Button size="lg" onClick={form.next} disabled={!!form.pending}>
            {form.pending === "complete" && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {nextLabel}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      <AlertDialog open={leaveTo !== null} onOpenChange={(open) => !open && setLeaveTo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save your changes first?</AlertDialogTitle>
            <AlertDialogDescription>
              You've changed this step since it was last saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                form.discard();
                if (leaveTo) router.push(leaveTo);
              }}
            >
              Discard
            </Button>
            <Button
              onClick={async () => {
                const href = leaveTo;
                if ((await form.saveDraft()) && href) router.push(href);
                else setLeaveTo(null); // errors are now shown on the form
              }}
            >
              {form.completed ? "Save changes" : "Save draft"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

`apps/web/src/components/onboarding/browser-intl.ts`:

```ts
"use client";

import { useSyncExternalStore } from "react";

// Client-only values (null during SSR): the server's ICU data can differ from the browser's,
// which would otherwise cause hydration mismatches.
let zones: readonly string[] | undefined;
const noopSubscribe = () => () => {};
const getZones = () => (zones ??= Intl.supportedValuesOf("timeZone"));
const getZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const none = () => null;

export const useBrowserTimeZones = () => useSyncExternalStore(noopSubscribe, getZones, none);
export const useBrowserTimeZone = () => useSyncExternalStore(noopSubscribe, getZone, none);
```

- [ ] **Step 5: Import step (skip only in slice 1)**

`apps/web/src/components/onboarding/import-step.tsx`:

```tsx
"use client";

import { parseGithubUsername } from "@redlance/core";
import { FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, controlProps } from "./field";
import { StepActions } from "./step-actions";
import { StepHeader } from "./step-header";
import { useStepForm, type StepFormInit } from "./use-step-form";

export function ImportStep({ init }: { init: StepFormInit<"import"> }) {
  const form = useStepForm(init, {
    // The field accepts "octocat", "@octocat" or a github.com URL; we store the bare username.
    // Unparseable text is kept as typed so the schema shows the error.
    prepare: (v) => {
      const typed = v.githubUsername?.trim() ?? "";
      return { githubUsername: typed ? (parseGithubUsername(typed) ?? typed) : null };
    },
  });
  const error = form.errorFor("githubUsername");
  const hint = "Optional. Your username or a github.com link. Drafts can link your work from it.";

  return (
    <>
      <StepHeader
        title="Let's set up your profile"
        description="Redlance matches Reddit hiring posts to your skills, so it needs to know what you do. It takes about three minutes, and you can change everything later."
      />
      <fieldset disabled={!!form.pending} className="space-y-6">
        <Field id="githubUsername" label="GitHub" optional hint={hint} error={error}>
          <Input
            {...controlProps("githubUsername", error, hint)}
            autoComplete="off"
            spellCheck={false}
            placeholder="octocat or github.com/octocat"
            value={form.value.githubUsername ?? ""}
            onChange={(e) => form.update({ githubUsername: e.target.value || null })}
            className="h-11 text-base md:text-sm"
          />
        </Field>
        <div className="rounded-xl border border-dashed border-feed bg-bone/60 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileText className="size-4" aria-hidden="true" /> Import a resume
            <span className="ml-auto rounded-full bg-feed px-2 py-0.5 text-[11px] font-medium text-stone">Coming soon</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">PDF or Word; we'll pre-fill the next steps for you.</p>
        </div>
      </fieldset>
      <StepActions
        form={form}
        back={null}
        nextLabel={form.value.githubUsername?.trim() ? "Next" : "Skip for now"}
        showDraft={false}
      />
    </>
  );
}
```

Slice 2 replaces the resume card with the real drop zone; slice 3 starts a GitHub import when a username is saved. (No GitHub icon: lucide-react 1.x has no brand icons.)

- [ ] **Step 6: Basics step**

`apps/web/src/components/onboarding/basics-step.tsx`:

```tsx
"use client";

import { CATEGORIES, COUNTRY_CODES, EXPERIENCE_LEVELS, LIMITS } from "@redlance/core";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { useBrowserTimeZone, useBrowserTimeZones } from "./browser-intl";
import { Field, FieldGroup, controlProps } from "./field";
import { RestoreBanner, StepActions } from "./step-actions";
import { StepHeader } from "./step-header";
import { useStepForm, type StepFormInit } from "./use-step-form";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRIES = COUNTRY_CODES.map((code) => ({ code, name: regionNames.of(code) ?? code })).sort(
  (a, b) => a.name.localeCompare(b.name, "en"),
);

const LEVEL_TEXT: Record<(typeof EXPERIENCE_LEVELS)[number], [string, string]> = {
  beginner: ["Getting started", "A few projects or none paid yet"],
  intermediate: ["Some paid work", "Regular clients or a year or two in"],
  experienced: ["Experienced", "Several years of client work"],
};

export const selectClass =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

export function BasicsStep({ init }: { init: StepFormInit<"basics"> }) {
  const browserZone = useBrowserTimeZone();
  const zones = useBrowserTimeZones();
  const form = useStepForm(init, {
    // The browser's zone is the default until the user picks one.
    prepare: (v) => ({ ...v, timeZone: v.timeZone ?? browserZone }),
  });
  const v = form.value;
  const zone = v.timeZone ?? browserZone ?? "";
  const zoneOptions = zones ?? (zone ? [zone] : []);

  function toggleCategory(id: (typeof CATEGORIES)[number]["id"]) {
    const has = v.categories.includes(id);
    form.update({ categories: has ? v.categories.filter((c) => c !== id) : [...v.categories, id] });
  }

  return (
    <>
      <StepHeader title="The basics" description="What clients see first, and what kind of work you want." />
      <RestoreBanner form={form} />
      <fieldset disabled={!!form.pending} className="space-y-6">
        <Field id="displayName" label="Your name" hint="As you'd sign a message to a client." error={form.errorFor("displayName")}>
          <Input
            {...controlProps("displayName", form.errorFor("displayName"))}
            autoComplete="name"
            maxLength={LIMITS.displayName}
            value={v.displayName}
            onChange={(e) => form.update({ displayName: e.target.value })}
            className="h-11 text-base md:text-sm"
          />
        </Field>

        <Field id="headline" label="Headline" optional hint={`${v.headline.length}/${LIMITS.headline} · e.g. "Video editor for YouTube creators"`} error={form.errorFor("headline")}>
          <Input
            {...controlProps("headline", form.errorFor("headline"), "hint")}
            maxLength={LIMITS.headline}
            value={v.headline}
            onChange={(e) => form.update({ headline: e.target.value })}
            className="h-11 text-base md:text-sm"
          />
        </Field>

        <FieldGroup legend="What kind of work do you want?" hint="Pick up to 3. This decides which subreddits Redlance watches for you." error={form.errorFor("categories")} errorKey="categories">
          <div className="grid gap-2 sm:grid-cols-2">
            {CATEGORIES.map((c) => {
              const on = v.categories.includes(c.id);
              const full = !on && v.categories.length >= LIMITS.categories;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => toggleCategory(c.id)}
                  className={cn(
                    "rounded-xl border px-3.5 py-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                    on ? "border-ink bg-ink text-white" : "border-border bg-background hover:border-foreground/25",
                  )}
                >
                  <span className="block text-sm font-medium">{c.name}</span>
                  <span className={cn("block text-xs", on ? "text-white/70" : "text-muted-foreground")}>{c.hint}</span>
                </button>
              );
            })}
          </div>
        </FieldGroup>

        <FieldGroup legend="Experience" error={form.errorFor("experienceLevel")} errorKey="experienceLevel">
          <div className="grid gap-2 sm:grid-cols-3">
            {EXPERIENCE_LEVELS.map((level) => (
              <label
                key={level}
                className="flex cursor-pointer flex-col rounded-xl border border-border px-3.5 py-3 has-checked:border-ink has-checked:bg-bone has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              >
                <input
                  type="radio"
                  name="experienceLevel"
                  value={level}
                  checked={v.experienceLevel === level}
                  onChange={() => form.update({ experienceLevel: level })}
                  className="sr-only"
                />
                <span className="text-sm font-medium">{LEVEL_TEXT[level][0]}</span>
                <span className="text-xs text-muted-foreground">{LEVEL_TEXT[level][1]}</span>
              </label>
            ))}
          </div>
        </FieldGroup>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field id="country" label="Country" error={form.errorFor("country")}>
            <select
              {...controlProps("country", form.errorFor("country"))}
              autoComplete="country"
              value={v.country ?? ""}
              onChange={(e) => form.update({ country: e.target.value || null })}
              className={selectClass}
            >
              <option value="">Choose…</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field id="timeZone" label="Time zone" hint="Used for alert timing and posting-hour insights." error={form.errorFor("timeZone")}>
            <select
              {...controlProps("timeZone", form.errorFor("timeZone"), "hint")}
              value={zone}
              onChange={(e) => form.update({ timeZone: e.target.value })}
              className={selectClass}
            >
              {!zone && <option value="">Choose…</option>}
              {zoneOptions.map((z) => (
                <option key={z} value={z}>{z.replaceAll("_", " ")}</option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>
      <StepActions form={form} back="import" />
    </>
  );
}
```

Note: `controlProps(id, error, "hint")` passes any truthy hint only to decide `aria-describedby`; the text itself is rendered by `Field`.

- [ ] **Step 7: Render them from the page**

In `[step]/page.tsx`, replace the placeholder:

```tsx
import { BasicsStep } from "@/components/onboarding/basics-step";
import { ImportStep } from "@/components/onboarding/import-step";
import { stepInit } from "@/server/onboarding/page-data";
// …
        {step === "import" && <ImportStep key={step} init={stepInit(state, user.userId, "import")} />}
        {step === "basics" && <BasicsStep key={step} init={stepInit(state, user.userId, "basics")} />}
```

- [ ] **Step 8: Check it**

```bash
npm test -w @redlance/web && npm run typecheck -w @redlance/web && npm run lint -w @redlance/web
npm run dev
```

In the browser:
- Import: `github.com/octocat` is saved as `octocat`; `octo cat` shows an error; empty → "Skip for now" → Basics.
- Next on an empty Basics shows the errors and focuses the first one.
- Fill two fields → Save draft → "Draft saved" → reload → values back, still on Basics.
- Type more, then close the tab: the browser warns. Reopen: "Restore them" brings the edits back.
- Save in two tabs: the second shows the conflict message.
- Next → lands on `/onboarding/skills` (placeholder).
- Keyboard only: every control is reachable, and the chips announce pressed/not pressed.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "Add the step form hook with drafts, conflicts and a local safety net; Import and Basics steps"
```

---

### Task 11: Skills and Rates steps

**Files:**
- Create: `apps/web/src/components/onboarding/skills-step.tsx`, `rates-step.tsx`, `tag-input.tsx`
- Modify: `apps/web/src/app/(onboarding)/onboarding/[step]/page.tsx`

**Interfaces:**
- Consumes: `searchSkills`, `findSkill`, `skillsForCategories`, `SKILL_BY_ID`, `LIMITS`, `CURRENCIES`, `RATE_TYPES` (core); `savedDraft` (page data).
- Page props: Skills gets `jobTypes` (Basics categories).

- [ ] **Step 1: Skills step**

`apps/web/src/components/onboarding/skills-step.tsx`. The behaviour to build:

```tsx
"use client";

import { LIMITS, SKILL_BY_ID, findSkill, normalizeSkillName, searchSkills, skillsForCategories, type CategoryId } from "@redlance/core";
import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { FieldGroup, controlProps } from "./field";
import { RestoreBanner, StepActions } from "./step-actions";
import { StepHeader } from "./step-header";
import { useStepForm, type StepFormInit } from "./use-step-form";

type Level = "core" | "secondary";
const DEFAULT_CORE = 3; // the first three added start as core; users can change it

export function SkillsStep({ init, jobTypes }: { init: StepFormInit<"skills">; jobTypes: CategoryId[] }) {
  const form = useStepForm(init);
  const searchId = useId();
  const [query, setQuery] = useState("");
  const v = form.value;
  const chosen = new Set(v.skills.map((s) => s.id));
  const total = v.skills.length + v.customSkills.length;
  const coreCount = [...v.skills, ...v.customSkills].filter((s) => s.level === "core").length;
  const nextLevel = (): Level => (coreCount < DEFAULT_CORE ? "core" : "secondary");
  const full = total >= LIMITS.totalSkills;

  const results = searchSkills(query, { categories: jobTypes, limit: 8 }).filter((s) => !chosen.has(s.id));
  const exact = findSkill(query);
  const customName = query.trim();
  const canAddCustom =
    customName.length > 0 &&
    customName.length <= LIMITS.customSkillName &&
    !exact &&
    !v.customSkills.some((c) => normalizeSkillName(c.name) === normalizeSkillName(customName));
  const popular = skillsForCategories(jobTypes, 16).filter((s) => !chosen.has(s.id)).slice(0, 10);

  function addSkill(id: string) {
    if (full || chosen.has(id)) return;
    form.update({ skills: [...v.skills, { id, level: nextLevel(), source: "manual" }] });
    setQuery("");
  }
  function addCustom() {
    if (exact) return addSkill(exact.id); // "reactjs" typed → the React skill, not a custom one
    if (!canAddCustom || full) return;
    form.update({ customSkills: [...v.customSkills, { name: customName, level: nextLevel(), source: "manual" }] });
    setQuery("");
  }
  const setLevel = (kind: "skills" | "customSkills", index: number, level: Level) =>
    form.update({ [kind]: v[kind].map((s, i) => (i === index ? { ...s, level } : s)) } as Partial<typeof v>);
  const remove = (kind: "skills" | "customSkills", index: number) =>
    form.update({ [kind]: v[kind].filter((_, i) => i !== index) } as Partial<typeof v>);

  // Render, top to bottom:
  //  - StepHeader "Your skills" / "Mark the ones you'd most like to be hired for as core (up to 8)."
  //  - RestoreBanner
  //  - Search <Input {...controlProps(searchId, form.errorFor("skills"))} placeholder="Search skills, tools or software"
  //      onKeyDown: Enter → results[0] ? addSkill(results[0].id) : addCustom()>
  //    + a listbox-free result list: buttons "＋ {name}" (category name in muted text), and when canAddCustom,
  //      a button `Add "{customName}" as your own skill`.
  //  - "Popular for your job types": `popular` as small outline chips "＋ {name}" (hidden while typing).
  //  - Two FieldGroups: "Core skills ({coreCount}/8)" and "Other skills". Each chosen skill (taxonomy name from
  //    SKILL_BY_ID, custom name as typed + a muted "custom" tag) is a chip with a
  //    "Make core"/"Make other" text button (aria-label includes the skill name) and an X remove button
  //    (aria-label `Remove {name}`).
  //    Error text: form.errorFor("skills") / form.errorFor("customSkills") under the groups.
  //  - Counter "{total}/30 skills"; when `full`, the search is disabled with the hint "That's the maximum".
  //  - StepActions back="basics"
}
```

Implement the render as described, with the same Tailwind vocabulary as `BasicsStep` (chips: `rounded-full border px-3 py-1.5 text-sm`; core chips `border-ink bg-ink text-white`). Wrap the controls in `<fieldset disabled={!!form.pending}>`.

- [ ] **Step 2: Tag input (blocked words)**

`apps/web/src/components/onboarding/tag-input.tsx`: a text input plus chips. Enter or comma adds the trimmed word (ignored if empty, a duplicate ignoring case, or over `maxLength`); Backspace on an empty input removes the last chip; each chip has a remove button labelled `Remove {word}`. Props: `{ id, values, onChange, max, maxLength, placeholder, invalid, describedBy }`.

- [ ] **Step 3: Rates step**

`apps/web/src/components/onboarding/rates-step.tsx`:

- Header: "Rates & filters" / "Redlance skips posts that don't fit. You can change these any time."
- "Minimum budget" row: a number `<Input inputMode="decimal" step="0.01" min={0}>` and a currency `<select>` (the four `CURRENCIES`) side by side. The input keeps its own text state so "12." can be typed; `onChange` → `minRate: text === "" ? null : Number(text)`. Hint: "0 means any budget. Posts that state a lower budget are skipped." Errors `minRate`, `currency`.
- "Rate type" radio cards (same pattern as experience): Hourly / Fixed price / Either. Error `rateType`.
- "Remote only" checkbox (native, `accent-ink size-4`) with label "Only show remote gigs".
- "Blocked words" `TagInput`, hint `Posts containing these are skipped, e.g. "unpaid", "exposure", "equity only". Up to 50.` Error `blockedWords`.
- `StepActions back="skills" nextLabel="Review"`.

- [ ] **Step 4: Wire them into the page**

```tsx
import { savedDraft } from "@/server/onboarding/page-data";
// …
        {step === "skills" && (
          <SkillsStep key={step} init={stepInit(state, user.userId, "skills")} jobTypes={savedDraft(state, "basics")?.categories ?? []} />
        )}
        {step === "rates" && <RatesStep key={step} init={stepInit(state, user.userId, "rates")} />}
```

- [ ] **Step 5: Check it**

```bash
npm test -w @redlance/web && npm run typecheck -w @redlance/web && npm run lint -w @redlance/web
npm run dev
```

In the browser, after Basics with "Video":
- Skills: "Popular" shows video skills first. Typing "reactjs" + Enter adds React (not a custom skill). Typing "Descript" offers `Add "Descript" as your own skill`. The 9th core toggle shows the 8-core error on save. Next with no core skill shows "Mark at least one skill as core."
- Rates: the currency defaults from the country (e.g. India → INR). `1.005` is refused. Blocked words dedupe ignoring case.
- Next on Rates → Review (placeholder).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "Add the Skills and Rates steps"
```

---

### Task 12: Review, Finish and the dashboard link

**Files:**
- Create: `apps/web/src/components/onboarding/review-step.tsx`, `apps/web/src/server/onboarding/trial.ts`, `apps/web/src/server/onboarding/trial.test.ts`
- Modify: `apps/web/src/app/(onboarding)/onboarding/[step]/page.tsx`, `apps/web/src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Trial days helper (test first)**

`apps/web/src/server/onboarding/trial.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { trialDaysLeft } from "./trial";

describe("trialDaysLeft", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  it("rounds up partial days and never goes below 0", () => {
    expect(trialDaysLeft(new Date("2026-10-06T12:00:00Z"), now)).toBe(5);
    expect(trialDaysLeft(new Date("2026-10-01T13:00:00Z"), now)).toBe(1);
    expect(trialDaysLeft(new Date("2026-09-30T12:00:00Z"), now)).toBe(0);
  });
});
```

`apps/web/src/server/onboarding/trial.ts`:

```ts
const DAY_MS = 86_400_000;

/** Whole days left in the trial, rounded up (kept out of components: render must stay pure). */
export function trialDaysLeft(trialEndsAt: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS));
}
```

- [ ] **Step 2: Review step**

`apps/web/src/components/onboarding/review-step.tsx` (client), props `{ data: ReviewData; email: string }`:

- Header: "Check and finish" / "Finishing starts your 5-day trial."
- One section per step (`GitHub`, `Basics`, `Skills`, `Rates & filters`), each an `<h2>` with an "Edit" link to `/onboarding/<step>` (`aria-label="Edit basics"` …). Content:
  - Basics: name, headline, job type names, experience text, country name (`Intl.DisplayNames`) and time zone.
  - Skills: core skill names, then others (taxonomy names via `SKILL_BY_ID`, custom names as typed).
  - GitHub: `github.com/<username>` as a link (`target="_blank" rel="noopener noreferrer"`), or "Not added". Edit goes to `/onboarding/import`.
  - Rates: `formatMoney(minRate, currency)` via `Intl.NumberFormat("en", { style: "currency", currency })`, or "Any budget" for 0; rate type; remote only; blocked words.
- A "What happens next" box:
  - "Redlance will watch {n} subreddits for your job types: r/forhire, …" (`subredditsFor(data.basics.categories)`, shown descriptively).
  - "New matches are emailed to {email}. You can add Telegram later from the dashboard."
- A Finish button (`size="xl"`, full width on mobile) that:
  1. `POST /api/v1/onboarding/finish`;
  2. on 200, `router.replace(body.redirect)` then `router.refresh()`;
  3. on 409 `STEP_ORDER`, `router.push(\`/onboarding/${body.error.details.resumeAt}\`)`;
  4. otherwise shows the error message (role="alert").

  It is disabled while pending, with the label "Finishing…".
- "Back" link to `/onboarding/rates`.

Page wiring:

```tsx
import { reviewData } from "@/server/onboarding/page-data";
// …
  if (step === "review") {
    const review = reviewData(state);
    if (!review.ok) redirect(`/onboarding/${review.step}`);
    // render <ReviewStep data={review.data} email={user.email} /> in the card
  }
```

- [ ] **Step 3: Dashboard**

In `apps/web/src/app/(app)/dashboard/page.tsx`:
- Load `getOnboardingState(user.userId)`.
- When **not onboarded**, replace the disabled "Coming next" span with a link styled via `buttonVariants({ size: "lg" })` to `/onboarding`. The label is "Start setup" if no steps are saved, else `Continue setup · step ${pageIndex(state.resumeAt) + 1} of 5`. The copy becomes: "Add your job types and skills so Redlance can match gigs to you. Your 5-day trial starts when you finish."
- When **onboarded**, drop the card and show under the welcome line: `Your trial: {trialDaysLeft(state.trialEndsAt!)} days left.` (or "Your trial has ended." at 0).

- [ ] **Step 4: Check the whole flow**

```bash
npm test && npm run typecheck && npm run lint
npm run dev
```

In the browser with a fresh email:
- Dashboard → "Start setup" → all five pages → Finish → dashboard shows "5 days left" and no setup card.
- `/onboarding/basics` now redirects to `/dashboard`.
- Double-click Finish: one profile (check with `psql` or the service tests).
- In `psql`: `select subreddit from user_subreddits;` lists the general boards plus the ones for the chosen job types. `alert_channels` has one email row.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "Add the review page and Finish, and link the dashboard setup card to onboarding"
```

---

### Task 13: Docs, full checks and review

**Files:**
- Modify: `CLAUDE.md` ("Where we are"), `README.md` if it lists packages

- [ ] **Step 1: Full checks**

```bash
npm run db:reset
npm test
npm run typecheck
npm run lint
npm run build
npm run format:check
```

Expected: all pass; `db:reset` ends with "Migrations applied and reference data synced."

- [ ] **Step 2: Update the handover**

In `CLAUDE.md` "Where we are":
- Move onboarding slice 1 under "Built so far". Cover: `@redlance/core` (taxonomy of 12 job types, subreddit seed list, step schemas), the tables, the step API, the pages, Finish.
- Record the deferred minors found while building.
- Next steps: slice 2 plan (worker + resume import), then slice 3.

- [ ] **Step 3: Code review**

Run one fresh code review of the whole branch against `main` (the "Review Focus" list at the top is the checklist). Fix what it confirms, re-run Step 1, and commit:

```bash
git add -A
git commit -m "Update the handover for onboarding slice 1"
```

Then ask the user before pushing or opening a PR.
