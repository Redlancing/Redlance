# Projects and experience from the resume: design

Date: 2026-10-17 · Status: **decided, not built**. The user answered the open questions on 2026-10-17. Plan: `projects-experience-plan.md`. Builds on onboarding slices 1–3: `conclusion.md` describes the code this changes, and `design.md` holds the original rules this keeps.

## Goal

Resume import already fills Basics and Skills. This adds two more things, kept apart:

- **Projects:** standalone pieces of work from the resume's Projects section, such as a side project, a hackathon app, or a client site listed as a project.
- **Experience:** one entry per job from the Experience section. Work done inside a job goes into that job's highlights, not into Projects.

The user checks and edits both on a new onboarding step, **Projects & experience**. Finish saves them to two new tables. Later, matching uses them to raise a score and name a project in the reason line. Drafting picks one project per gig (proof, plus a link if it has one) and one experience line (credibility). Drafts only use stored fields, so nothing is invented (CLAUDE.md rule 6).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where projects come from | **Only the resume's Projects section.** Not GitHub repos | User decision. Repo names and descriptions say little, and the resume is what the user chose to show |
| Projects vs experience | Two lists. Work done inside a job goes into that role's `highlights` | A draft needs "what I built" and "where I worked" as separate, short facts |
| Limits | 8 projects and 6 roles; up to 4 highlights or 3 outcomes each | Enough for a draft to pick one. It keeps prompts, output tokens and the step row small |
| Who decides what | The model writes titles, summaries, kinds, tags and client names. **Code** finds dates, years and links, and runs the skill checks, the verbatim checks and the name replacement | Code is exact and free for anything a regex can read. The model only does the parts that need reading |
| Links | Found by **regex** in the project's own text and checked only for format. Our servers **never fetch or visit them** | This leaves no SSRF risk, costs nothing, and doesn't track the user's sites |
| Placement (confirmed 2026-10-17) | **Import → Basics → Skills → Projects & experience → Rates & filters → Review** at `/onboarding/work`: 6 pages | The entries carry skill ids, so the step comes right after the user settles their skills. The three pages a resume fills sit together, and Rates (never imported) comes after them. Skills is already the longest page, so this doesn't go there |
| Step can be empty | Yes. Pressing Next with no entries completes the step | Many users have no resume, and nothing on this step is required |
| Domains (decided 2026-10-17) | Each entry gets up to 4 tags from a **fixed list of 30** in core (`DOMAIN_IDS`). The list is below, **for the user's review** | Free text drifts ("ecommerce", "online retail"). A fixed list can be matched against post words through aliases and can feed insights later |
| Employer names | **Store them, but ask before using them.** `organisation` is stored, but drafts use `organisationDescription` unless `profiles.mention_employers` is on (off by default). The stored title, summary and highlights never name the employer, for any employment type (2026-10-17) | Employers are useful context for the user and for later features. Naming them in public is the user's call |
| Freelance and contract roles (decided 2026-10-17) | `organisation` is dropped for **every** freelance and contract role, not only those with a client. Only the title and a generic description are kept | For these roles the "organisation" is often a client, and code can't reliably tell an agency from a client |
| Client names (decided 2026-10-17) | **Removed automatically, not just flagged.** The model lists the client names in each highlight and outcome, each with a generic phrase to use instead. Code checks that each name really occurs in the text, then swaps it for the phrase. For freelance and contract roles there is a second pass that doesn't rely on the model: the role's organisation is scrubbed from the role's text before the organisation is dropped. The user can edit any text afterwards | Drafts are public Reddit comments, and naming a client can break an NDA. Swapping in a generic phrase keeps the fact without the name. Code does the swap, so the model can't change other words |
| Review | Happens **in onboarding**, on the new step | The user sees and fixes what was extracted before it can reach any draft |
| Models (decided 2026-10-17) | Both new steps use **`VERTEX_MODEL_FAST`** (Flash-Lite) | It costs about a seventh of Flash per token. Code checks every fact, so a cheaper reader is enough |
| Pipeline deadline (confirmed 2026-10-17) | Goes from **20 s to 25 s** | The two new steps write the most text. The extra 5 s leaves room for one retry |
| Quality checks (decided 2026-10-17) | **No evaluator.** Unit tests use the stub LLM, and quality is checked **by hand on real resumes** during development | Keeps the build small. The existing eval isn't extended |
| Older imports (decided 2026-10-17) | **No compatibility.** Suggestions go to v2 outright, with no v1 support or upgrade path. After the migration, run `npm run db:reset` locally and sign in again | We are still building, and there are no real users or data to keep |

### Domain list (for the user's review)

`DOMAIN_IDS` in `packages/core/src/work.ts`. The aliases in brackets are for matching post text later:

| | | |
|---|---|---|
| `e-commerce` (ecommerce, online store, shopify store) | `retail` (shops, stores) | `fintech` (payments, neobank) |
| `finance` (banking, insurance, accounting) | `crypto` (web3, blockchain, defi) | `real-estate` (property, realtor) |
| `health` (healthcare, medical, clinic) | `fitness` (wellness, gym) | `food` (restaurant, food delivery) |
| `travel` (hospitality, hotel, tourism) | `education` (edtech, school, courses) | `gaming` (games, esports) |
| `saas` (b2b software, startup tools) | `marketing` (advertising, adtech, agency) | `media` (news, publishing, blog) |
| `entertainment` (film, streaming, events) | `music` (audio, podcast) | `fashion` (apparel, clothing) |
| `beauty` (cosmetics, salon) | `automotive` (cars, dealership) | `logistics` (shipping, supply chain) |
| `manufacturing` (industrial, factory) | `construction` (architecture, contractors) | `energy` (solar, utilities) |
| `legal` (law firm, compliance) | `non-profit` (charity, ngo) | `government` (public sector, civic) |
| `sports` (teams, athletes) | `social` (community, dating, social network) | `recruiting` (hr, hiring, jobs) |

## What we extract

**Projects** (from the blocks of the `projects` section):

| Field | From | Rule |
|---|---|---|
| `title` | model, ≤80 characters | Must appear in its block (case and spaces normalised); otherwise the project is dropped. Client names are then replaced |
| `summary` | model, ≤160 characters | One reworded sentence with no company or client names. Links are stripped (with `stripLinks` from `merge.ts`) and client names replaced |
| `role` | model | `solo` / `lead` / `team` / `unknown`. Set only if the resume says so |
| `kind` | model | `client` / `employer` / `personal` / `open_source` / `academic` / `hackathon` / `unknown` |
| `skills` | model, ≤10 | Limited to the pre-pass shortlist by a per-call enum, like `outputSchemaFor` in `apps/worker/src/ingest/analyse-post.ts`. A skill is kept only if one of its labels occurs in the block (`skillLabelOccurs`) |
| `categories` | model, ≤2 | `CATEGORY_IDS` enum |
| `domains` | model, ≤4 | `DOMAIN_IDS` enum |
| `outcomes` | model, ≤3, each ≤160 characters, each with `clientNames` | Kept only if the quote appears **verbatim** in the block (`hasEvidence`). Then client names are replaced |
| `links` | **regex**, ≤3 | Found in the block's text; see "Links" |
| `year` | **pre-pass** | The end year of the block's first date range ("present" counts as this year). Otherwise the latest plain year in the block, otherwise null |

**Experience** (from the blocks of the `experience` section):

| Field | From | Rule |
|---|---|---|
| `title` | model, ≤80 characters | Must appear in its block; otherwise the role is dropped |
| `organisation` | model, ≤80 characters, can be null | Must appear in its block, otherwise null. For `freelance` and `contract` roles it is used to scrub the role's text and then dropped (see "Removing client names") |
| `organisationDescription` | model, ≤60 characters | A generic description such as "a fintech payments company". It must not contain `organisation` |
| `employmentType` | model | `full_time` / `part_time` / `freelance` / `contract` / `internship` / `unknown` |
| `start`, `end`, `current` | **pre-pass** | From the block's first date range, as `{ year, month \| null }`. `current` is true when the range ends in present, current or now |
| `summary` | model, ≤160 characters | Reworded. Names are replaced as for highlights |
| `highlights` | model, ≤4, each ≤160 characters, each with `clientNames` | Verbatim-checked against the block, then names replaced. Work done inside the job goes here |
| `skills`, `categories`, `domains` | model | Same rules as for projects |

Duration is worked out from `start` and `end` when needed. It isn't stored.

## Pipeline changes (`apps/worker/src/resume/`)

```
text ─▶ pre-pass: sections ─▶ entry blocks ─▶ dates, years, links per block
     ─▶ 5 steps in parallel: basics, jobTypes, skills, projects*, experience*   (* only when their section has text)
     ─▶ checks (block evidence, verbatim, shortlist) ─▶ client-name removal ─▶ merge ─▶ suggestions v2
```

### Pre-pass

**1. Headings (`sections.ts`).** Widen the patterns, and record whether any heading was found:

```ts
["projects", /^((personal|key|side|selected|notable|academic|university|capstone|freelance|client|independent|open[- ]source)\s+)?projects?$|^(portfolio|selected work|client work|case studies|open[- ]source( contributions)?|hackathons?)$/i],
["experience", /^((work|professional|relevant|freelance|industry)\s+)?experience$|^(employment( history)?|work history|career history|internships?)$/i],
```

`splitSections` keeps its shape. A new field, `PipelineInput.headed: boolean`, says whether any heading was found. The sections object stays all strings, so `dev-report.ts` keeps working.

**2. Entry blocks (new file `entries.ts`, pure functions).** This splits one section into blocks, one per job or project:

```ts
export type Block = {
  id: string;                 // "E1".."En" or "P1".."Pn": the model refers to blocks by id
  text: string;
  range: DateRange | null;    // the block's first date range (dates.ts)
  year: number | null;        // projects only
  links: string[];            // projects only
};
export function splitEntries(section: string, kind: "experience" | "projects"): Block[];
```

How it splits, line by line:
- A **bullet** line starts with `- – • * ▪ ◦ ●`, `1.` or `1)`. A **head** line isn't blank, isn't a bullet, and is at most 120 characters.
- A head line starts a new block when it is the first line, comes after a blank line, or comes after a bullet line.
- A head line right after another head line joins the same block. This handles a title on one line and "Company · Jan 2021 – Present" on the next.
- Experience only: a head line that holds a date range starts a new block if the current block already has one.
- **Fallbacks:**
  - If experience gives 0 or 1 blocks, split at every line that holds a date range.
  - If that still gives 1 block or none, the whole section is one block.
  - With more than 12 blocks, the extra blocks join the last one.
  - Each block is capped at 3,000 characters.
- **No headings at all** (`headed = false`, so every section is the whole text): experience splits the whole text with the date-line fallback, and **the projects step is skipped.** Without a Projects heading, projects can't be told apart from jobs. Work done in a job still lands in its highlights, and the user can add projects by hand.

Why blocks? The model only says which block an entry came from (`block: "E2"`). Code then attaches the dates, year and links, and every check runs against that block, not the whole resume. The block id is an enum built for each call, so the model can't point at a block that doesn't exist.

**3. Dates (`dates.ts`).** Split the current parser in two, without changing what `yearsOfExperience` returns:

```ts
export type DateRange = { start: { year: number; month: number | null };
                          end: { year: number; month: number | null } | null; current: boolean };
export function findRanges(text: string, now?: Date): DateRange[];   // same RANGE regex, year bounds, EDUCATION_LINE filter
export function yearsOfExperience(experience: string, now?: Date): number | null; // now built on findRanges
```

**4. Links (`checkLink` in core, `projectLinks` in the worker).**
- A regex finds `https?://…`, `www.…` and lowercase `domain.tld/path` in a project's block. The TLD list in `merge.ts` moves next to this regex.
- `checkLink` (in core, shared with the form) keeps a link only if `new URL()` parses it and it has:
  - the `https:` or `http:` scheme;
  - no username, password or port;
  - a hostname with a dot that isn't an IP address;
  - a total length of at most 300 characters.
- Trailing punctuation is trimmed, and a bare host gets `https://` in front.
- Email addresses and `mailto:` links are ignored.
- At most 3 links per project.
- **That's all: the link is never requested.**

### Two new steps (`steps/projects.ts`, `steps/experience.ts`)

| Step | Model | Input | Max output tokens | Timeout | Runs when |
|---|---|---|---|---|---|
| `projects` (`projects@2`) | fast (Flash-Lite) | Numbered project blocks, the shortlist (id — name), the 12 categories and the domain list | 2,000 | 14 s | `headed` is true and the projects section has text |
| `experience` (`experience@2`) | fast (Flash-Lite) | Numbered experience blocks and the same lists | 2,000 | 14 s | The experience section has text |

As today, the blocks go into the prompt inside `<resume>` tags (`resumePrompt` strips any fake closing tag). Each block starts with its id:

```
<resume>
[P1]
Shopfront for Acme Realty — Next.js site, 2023 · github.com/example/shopfront
- Cut page load from 4 s to 1 s for Acme Realty's 30 agents.
[P2]
…
</resume>
Task: projects
…
```

The schema is built for each call, like `outputSchemaFor`:

```ts
const clientNames = z.array(z.object({ name: z.string().max(80), generic: z.string().max(40) })).max(4);
function projectsSchemaFor(blockIds: string[], shortlist: string[]) {
  return z.object({ projects: z.array(z.object({
    block: z.enum(blockIds),
    title: z.string().max(80),
    summary: z.string().max(160),
    role: z.enum(PROJECT_ROLES), kind: z.enum(PROJECT_KINDS),
    skills: shortlist.length ? z.array(z.enum(shortlist)).max(10) : z.array(z.string()).max(0),
    categories: z.array(z.enum(CATEGORY_IDS)).max(2),
    domains: z.array(z.enum(DOMAIN_IDS)).max(4),
    outcomes: z.array(z.object({ text: z.string().max(160), clientNames })).max(3),   // text copied word for word
  })).max(8) });
}
```

Experience follows the same pattern, with these fields:
- `title`, `organisation` (can be null), `organisationDescription`, `employmentType` and `summary`;
- `highlights`: up to 4 objects, each `{ text, clientNames }`;
- `skills`, `categories` and `domains`;
- at most 6 roles.

The prompts say:
- never put client or company names in titles or summaries, and list any that are there anyway in the entry's own `clientNames` (review fix, 2026-10-17: names in titles survived when no line listed them);
- for each copied line, list every client name it contains, each with a generic phrase such as "a retail client" that shares no word with the name;
- describe the organisation generically;
- work done inside a job is a highlight of that job;
- use `unknown` rather than guess.

`StepSpec` gains two optional fields: `timeoutMs` (default 10 s) and a `skip(input)` check. `RESUME_STEP_NAMES` gains `projects` and `experience`. `PIPELINE_DEADLINE_MS` goes from 20,000 to 25,000.

### Removing client names (`names.ts`, pure)

```ts
/** Replaces each name that occurs in `text` as a whole word, ignoring case. Longest names first. */
export function replaceNames(
  text: string,
  names: { name: string; generic: string }[],
): { text: string; replaced: string[] };
```

The model lists names in two places: on each copied line (`clientNames` of an outcome or highlight) and on the entry itself (`clientNames` of the project or role, for its title and summary). As built (review fixes, 2026-10-17):

1. **Verbatim check on the original text.** The line must appear in its block (`hasEvidence`), or it is dropped. The title check runs on the original title too.
2. **Check each name against the block.** A `name` (entry-level or line-level) must occur in the entry's block as a whole word: case and spaces are normalised, and the name can't be part of a longer word ("Acme" doesn't match "Acmeville"). Names that don't occur, and names shorter than 2 characters, are ignored.
3. **Every name of an entry goes into every text field**: title, summary, `organisationDescription`, outcomes and highlights. For projects this applies to every kind, not only `client`.
4. **Phrases.** A `generic` is replaced by "a client" when it is empty, over 40 characters, holds a link, email or markup, or shares a word of 3+ letters with any listed name (case-folded, possessive `'s` dropped; "Acme's agency" for "Acme Realty"), or holds a name written as one word ("acmerealty"). Common words (the, inc, group, studio, agency, bank, …) don't count as shared, so "a design studio" works for "Bright Studio". `organisationDescription` follows the same rule against the listed names and the organisation, with "a client" (freelance, contract) or "a company" (other roles) as the fallback.
5. **Backup that doesn't rely on the model: the organisation.** Code looks for the model's `organisation` in the block: as given, then without a legal suffix (Inc, LLC, Ltd, GmbH, Pvt, Pvt. Ltd, Co., Corp…) and punctuation, then as the longest leading run of words that occurs (it must hold a word of 3+ letters that isn't a common word). The name as the block writes it is then replaced with `organisationDescription` (or the fallback) in **every** text field, **for every employment type**: the title and summary of a full-time role don't name the employer either (user decision, 2026-10-17). The name stays stored in `organisation` for non-freelance roles, so the `mention_employers` switch can use it later. For freelance and contract roles `organisation` is set to null; if their organisation isn't found in the block at all, the entry gets `namesRemoved: true` so the card asks the user to check.
6. **Links that name a client.** A project link whose host (without `www.`, the TLD, dots and hyphens) or path holds one of the entry's names as one word ("acmerealty.com/listings" for "Acme Realty") is dropped. The same links and bare domains are removed from outcomes, highlights and the title.
7. **Lines cut in a name.** A line that ends with the start of a listed name ("…for Acme Rea"; 3+ characters from a word start) loses that tail and any word left dangling ("for"). A line with fewer than 2 words left is dropped.
8. **Replace** each name with its phrase, longest names first, in one pass. Regex characters in names ("C&A", "Yahoo!") are escaped. Text that a phrase pushed over its limit is cut at a word boundary (between code points, never inside an emoji).
9. An entry where anything was replaced or removed gets `namesRemoved: true`. The card shows a small "Client name removed" note on it.

The user can edit any text on the card. That catches names both the model and code missed.

### Checks and merge (`merge.ts`)

| Check | If it fails |
|---|---|
| `title` appears in its block | Drop the entry |
| `organisation` appears in its block (also without a legal suffix, or as its leading words) | Set it to null |
| Each outcome or highlight appears verbatim in its block | Drop that line |
| Client names (see above) | Replace them; set `namesRemoved` |
| Every role | Scrub the role's text with `organisation`; for freelance and contract, then set it to null |
| `organisationDescription` shares a word with `organisation` or a listed name | Replace it with the employment type's default ("a client" / "a company") |
| Several entries come from one block | Each keeps only the links on its own lines (its title line up to the next entry's title) and a project year only from those lines; the block's dates go to the first role only, unless a role's own lines hold a range |
| A skill id is on the shortlist and one of its labels occurs in the block | Otherwise drop that skill |
| The summary contains a link, email or phone number | Strip the links; drop the summary if contact details remain |
| Duplicates (same normalised title) | Keep the first |
| Over the limits | Keep the first N in resume order |

Each drop is recorded as a `DroppedItem` (`what: "project" | "role" | "outcome" | "highlight" | …`), and each replacement as a `ReplacedName`, so the dev console shows both. Entries stay in resume order (block order).

### Cache key and versions

`PIPELINE_VERSION` becomes `resume@2`, because the headings and blocks change what every step reads. `resumeCacheKey` already joins every step's version and both models, so adding the two steps changes the key on its own. `meta.promptVersions` gains the two new step versions.

### Dev console (`dev-report.ts`)

- The pre-pass block adds `headed`, and for each block its id, length, date range, year and links.
- The two new steps print like the others.
- The merge section lists the dropped projects, roles and lines, and every replaced name (`"Acme Realty" → "a US real-estate agency"`).
- It runs only locally, so printing names there is fine.

## Suggestions v2 (`packages/core/src/suggestions.ts`)

`suggestionsSchema` moves to v2 outright, with no v1 support:

```ts
export const suggestionsSchema = z.strictObject({
  v: z.literal(2),
  meta: z.strictObject({ pipelineVersion, promptVersions, partial, skipped: z.array(z.enum(RESUME_STEP_NAMES)) }).optional(),
  basics, skills, customSkills, githubUsername,            // unchanged from v1
  projects: z.array(projectSuggestion).max(8).default([]),
  experience: z.array(experienceSuggestion).max(6).default([]),
});
```

- The worker writes v2 for resume and GitHub jobs (`merge.ts`, `github/map.ts`). GitHub jobs have empty lists.
- `mergeSuggestions` takes projects and experience from the resume only. `suggestedStepData("work", merged)` maps them to the step's draft with `source: "resume"`.
- `projectSuggestion`, `experienceSuggestion`, the constants, `checkLink` and `DOMAIN_IDS` live in a new `packages/core/src/work.ts`, used by both `suggestions.ts` and `onboarding.ts`.
- Stored v1 results would no longer parse (they would read as no suggestions). This is fine because local data is wiped: **after the migration, run `npm run db:reset` locally and sign in again.**

## Database (`packages/db`)

Finish writes these once, like `profile_skills`. Ids are UUIDv7 (`v7Id()` in `schema.ts`). Both tables reference `users(id) ON DELETE CASCADE`.

```
profile_projects
  id            uuid PK (v7)
  user_id       uuid → users, INDEX (user_id, position)
  position      smallint not null    CHECK 0 ≤ position < 8      -- order shown and used
  title         text not null        CHECK char_length 1–80
  summary       text not null        CHECK char_length ≤ 160
  role          text not null        CHECK in ('solo','lead','team','unknown')
  kind          text not null        CHECK in ('client','employer','personal','open_source','academic','hackathon','unknown')
  skill_ids     text[] not null default '{}'   CHECK cardinality ≤ 10
  categories    text[] not null default '{}'   CHECK cardinality ≤ 2
  domains       text[] not null default '{}'   CHECK cardinality ≤ 4
  outcomes      text[] not null default '{}'   CHECK cardinality ≤ 3
  links         text[] not null default '{}'   CHECK cardinality ≤ 3
  year          smallint null        CHECK 1950–2100
  source        text not null        CHECK in ('resume','manual')
  hidden        boolean not null default false  -- kept, but never used in drafts
  created_at, updated_at

profile_experience
  id, user_id, position (< 6), title, summary, skill_ids, categories, domains, source, hidden, created_at, updated_at   -- as above
  organisation              text null      CHECK char_length ≤ 80
  organisation_description  text not null  CHECK char_length ≤ 60
  employment_type           text not null  CHECK in ('full_time','part_time','freelance','contract','internship','unknown')
  start_year smallint null, start_month smallint null CHECK 1–12
  end_year   smallint null, end_month   smallint null CHECK 1–12
  is_current boolean not null default false
  highlights text[] not null default '{}'  CHECK cardinality ≤ 4
  CHECK (employment_type not in ('freelance','contract') or organisation is null)

profiles
  + mention_employers boolean not null default false
```

- **Arrays, not join tables, for skills and tags.** Matching reads one user's few entries at a time, so arrays are simpler and fast enough. The trade-off is that `skill_ids` has no foreign key; the app validates the ids. As in `profile_skills`, retired ids stay valid. A GIN index can come with matching if needed.
- `namesRemoved` is only shown on the onboarding card and isn't stored in these tables. What was removed can be rebuilt from `import_jobs.result` if it's ever needed.
- `onboarding_steps_step_check` gains `'work'`. Add `'work'` to `ONBOARDING_STEP_IDS`. Also add the new value lists (`PROJECT_ROLES`, `PROJECT_KINDS`, `EMPLOYMENT_TYPES`, `ENTRY_SOURCES`), copied from core and checked by the existing mirror test.
- **Migration:**
  1. Edit `schema.ts`.
  2. Run `npm run db:generate`; it writes `0008_projects_experience.sql`.
  3. Check that the generated SQL drops and re-adds the step CHECK.
  4. Commit the migration.
  5. Locally, run `npm run db:reset`.

## The new onboarding step

### Core (`packages/core/src/onboarding.ts`)

| Item | Change |
|---|---|
| `STEP_IDS` | `["import", "basics", "skills", "work", "rates"]` |
| `PAGE_IDS` | Follows it (`… "rates", "review"`): 6 pages |
| `PAGE_TITLES` | `work: "Projects & experience"` (URL `/onboarding/work`) |
| `LIMITS` | `projects: 8, roles: 6, entryTitle: 80, entrySummary: 160, orgDescription: 60, outcomes: 3, highlights: 4, links: 3, entrySkills: 10, domains: 4` |
| `STEP_SCHEMAS.work` | Draft and complete schemas, below |

```ts
const workShape = (complete: boolean) => z.strictObject({
  projects:   z.array(projectEntry(complete)).max(LIMITS.projects).default([]),
  experience: z.array(roleEntry(complete)).max(LIMITS.roles).default([]),
  mentionEmployers: z.boolean().default(false),
});
// entries: the suggestion fields as plain strings (no clientNames)
//          + source ('resume'|'manual', default 'manual') + hidden (default false) + namesRemoved (default false)
// draft:    every text field may be empty
// complete: projects need title + summary; roles need title + organisationDescription;
//           end not before start; links pass checkLink; freelance/contract → organisation null
```

- Empty lists are valid in both schemas.
- Step data holds no ids; the form gives each card a local key.
- At the limits, the row is about 30 KB, under the 64 KB cap on `onboarding_steps.data`.

### UI (`components/onboarding/work-step.tsx`)

- **Layout:** two sections, **Projects** and **Experience**, each a list of cards in resume order. A card shows the title, summary, year or dates, skill chips and links.
- **Links** are shown as text with `rel="noopener noreferrer nofollow"`. There are no previews or favicons, which would make the browser fetch the site.
- **"Client name removed":** a small note on cards with `namesRemoved`. It disappears once the user edits that card.
- **Edit** opens the card inline. It holds:
  - title and summary (with a character counter);
  - role and kind, or employment type;
  - month and year for start and end, plus "I work here now";
  - highlights or outcomes (add or remove lines);
  - skills (the existing skill search) and domains;
  - links, checked with `checkLink` when you leave the field.
- **Remove** deletes the card. **Use in replies** (on by default) sets `hidden`.
- **Add a project** and **Add a role** add empty manual cards. They are disabled at 8 projects and 6 roles.
- **Employer switch:** under Experience, a switch reads "Mention employer names in replies" (off by default). Its hint: "Off: replies say 'a fintech payments company'. You can still change it for a single reply later." The per-reply override is for the later draft editor; nothing here builds it.
- **Note** above both lists: "Replies are public. We remove client names we find; check nothing is left."
- **Empty state** (no import, or nothing found): "No resume? Add a project or a role by hand, or skip this for now." Next is always allowed.
- **Partial import:** if `meta.partial` lists `projects` or `experience`, the step shows "We couldn't read your projects. Add them by hand." If `meta.skipped` lists one (no such section, or no headings), it shows "We didn't find a Projects section in your resume, so add any projects by hand." instead.
- **Form behaviour:** the step uses `useStepForm` unchanged. That gives Next / Save draft / Save changes, `VERSION_CONFLICT` handling, the `beforeunload` warning, and the local copy `rl:onb:<userId>:work` with its restore banner.
- **Review** gets a "Projects & experience" section (titles, counts and the employer switch) with an Edit link.

### Pre-fill, re-import, progress and Finish

- **Pre-fill:** `defaultsFor` in `page-data.ts` handles `"work"` the same way as Basics and Skills. The form shows the saved row, otherwise `suggestedStepData("work", merged)`, otherwise empty.
- **Re-import:**
  - `resetForReimport` deletes `basics` and `skills`, and **`work` only when a resume import was accepted** (a GitHub-only re-import never fills `work`, so it keeps it). The client sends the accepted kinds as `{ kinds: ["resume", "github"] }`; without `kinds` only Basics and Skills are cleared. The local copy of `work` is cleared under the same rule.
  - The dialog in `import-step.tsx` reads "Replace Basics, Skills, and Projects & experience?" when a resume is being imported, otherwise "Replace Basics and Skills?". It opens when any of those three steps has a saved row (`hasSavedProfileSteps` in `[step]/page.tsx`).
- **Progress:** `progress.tsx` already uses `PAGE_IDS.length`, so it shows "Step N of 6". The dashboard card hardcodes `of 5` (`app/(app)/dashboard/page.tsx:69`); change it to use `PAGE_IDS.length`.
- **Finish:**
  - `completedSteps` also validates `work`.
  - `finishOnboarding` inserts `profile_projects` and `profile_experience` (position = array index, plus `source` and `hidden`) and sets `profiles.mention_employers`, all in the same transaction.

## API changes

There are no new endpoints.

| Endpoint | Change |
|---|---|
| `PUT /api/v1/onboarding/steps/:step` | Accepts `work` (the params enum is `STEP_IDS`) |
| `GET /api/v1/onboarding` | Returns the `work` step; `resumeAt` can be `work` |
| `GET /api/v1/onboarding/imports/:id` | `suggestions` is v2 (`projects`, `experience`, `meta.skipped`) |
| `POST /api/v1/onboarding/imports/reset` | Takes `{ kinds: ("resume" \| "github")[] }` (default `[]`); also deletes the `work` row when `kinds` includes `resume` |
| `POST /api/v1/onboarding/finish` | Writes the two tables and `mention_employers` |

**Deploy note:** a full `work` save can reach about 30 KB, over the 8 KB body limit in the WAF common rule set. The deployment spec must exempt `PUT /api/v1/onboarding/steps/work`, as it does for the resume upload. The app's own 256 KB cap still applies.

## Costs and timing

These are estimates for a typical resume of 1–2 pages (about 5,000 characters). Flash-Lite prices come from `packages/llm/src/prices.ts`: $0.10 per million input tokens and $0.40 per million output tokens. **These prices are unverified placeholders**; confirm them on the Vertex pricing page.

| Step | Input tokens | Output tokens (with client names) | Cost |
|---|---|---|---|
| projects | ~1,700 (blocks ~400, plus instructions, shortlist and lists) | ~1,200–1,500 | ~$0.0007 |
| experience | ~2,300 | ~1,200–1,500 | ~$0.0008 |
| **Added per resume** | | | **~$0.0015** |

The first real resume cost about $0.0036, so a resume import becomes about **$0.005**, or roughly $5 per 1,000 users. A skipped step costs nothing.

**Timing.**
- The five calls run in parallel, so the wait is the slowest call.
- The new steps write the most text (about 1,300 tokens). Flash-Lite writes faster than Flash, so expect about 3–7 s.
- The two new steps time out at 14 s; the others stay at 10 s.
- The pipeline deadline is 25 s, so a fast failure still has time for its one retry. A step that runs out of time is listed in `meta.partial`, and the other steps' results still count.
- The worker's 90 s job limit and the browser's 60 s wait don't change.

**Vertex quota.** Each resume now makes 5 requests (up to 10 with retries), and 4 jobs can run at once. Size the Google Cloud project's request quota for that.

## Security and privacy

- **No link fetching.**
  - Links are found by regex and checked only for format.
  - No server, worker or page ever requests them: no unfurling, previews, favicons or "is it up" checks.
  - `javascript:`, `data:` and other schemes fail `checkLink`.
- **No client names.**
  - The prompts forbid client names in titles and summaries.
  - Names the model lists are replaced by code, and only when they really occur in the text.
  - Freelance and contract roles are scrubbed of their organisation, then keep none.
  - The card note and free editing catch what's left. Drafting (later) must still reword lines in one sentence without names.
- **Employer switch.** `organisation` is stored, but drafts use it only when `mention_employers` is on. Otherwise they use `organisationDescription`.
- **Untrusted text.**
  - Resume blocks stay inside `<resume>` tags under the existing system rule.
  - Model output is limited by enums and lengths, then checked against its own block.
  - A replacement phrase can only replace a name that occurs in the text, so it can't add claims elsewhere. It is capped at 40 characters.
  - Everything users type is stored as plain text and rendered by React, which escapes it.
  - When drafting later puts these fields into a prompt, they go inside data tags with the same "data, not instructions" rule.
- **Stored personal data** (employers, dates) is deleted with the account by the cascade. `llm_usage` still records no text, and logs never include entry text.

## Testing

Tests are written first and use stubs only (`apps/worker/test/stub-llm.ts` learns the two new steps). **There is no evaluator:** quality is checked by hand on real resumes during development, by reading the dev console report and the work-step cards.

| Area | Tests |
|---|---|
| core `work.ts` | Entry schemas (draft vs complete, limits, end not before start, freelance/contract → organisation null); `checkLink` (credentials, ports, IP addresses, schemes, length, trailing punctuation); `DOMAIN_IDS` are unique |
| core `suggestions.ts` | v2 parses; extra keys and `v: 1` are refused; `mergeSuggestions` takes projects only from the resume; `suggestedStepData("work")` |
| core `onboarding.ts` | `STEP_IDS` order; `nextPage("skills") === "work"`; `resumeAt` stops at a missing `work` row |
| worker `names.ts` | Name present → replaced; name absent → ignored, text unchanged; several names → all replaced; different case ("ACME corp" for "Acme Corp") → replaced; a name inside a longer word ("Acme" in "Acmeville") → not replaced; overlapping names ("Acme" and "Acme Corp") → longest first; regex characters ("C&A") → escaped; a generic that contains the name → ignored |
| worker `sections` | The new headings; the `headed` flag |
| worker `entries` | Head and bullet rules; two-line headers; the date-line fallback; the no-headings fallback; the 12-block and 3,000-character caps |
| worker `dates` | `findRanges` returns each range; `yearsOfExperience` gives the same results as before |
| worker links | The regex plus `checkLink` on real resume lines (`github.com/x/y` and `www.site.io` are links; `Node.js/React` is not) |
| worker merge | Every row of the checks table, including the freelance-organisation backup, `namesRemoved`, limits, order and duplicates |
| worker pipeline | 5 steps with the stub; projects skipped when `headed` is false; one new step failing → `partial`; the cache key changes; the 25 s deadline |
| db | The migration applies; the CHECKs refuse bad rows; the mirror lists match core |
| web | `saveStep("work")`; Finish writes both tables, `hidden`, the positions and the switch; reset clears `work`; `defaultsFor("work")`; the dashboard and progress copy; the card helpers (edit, remove, add, limits, empty state) |

The tests need Docker for Postgres and Valkey (`npm run db:up`).

## How it will be used later (not designed here)

- **Matching:** when a post's `job_post_analyses.skill_ids` and `categories` (plus domain words in its text) overlap a visible project or role, the score goes up. The reason line can name the match, for example "You built a Shopify store for a food brand".
- **Drafting:** per gig, a draft picks:
  - at most one project: its summary, plus a link if it has one;
  - at most one experience line: the title, plus the organisation or its description, depending on the switch.
  Each is one sentence. Only stored fields are used, so a draft can't claim work the user didn't list.

## Open questions

1. **Domain list:** the 30 tags above are waiting for the user's review.
2. **Flash-Lite prices** in `prices.ts` are unverified placeholders. Confirm them on the Vertex pricing page before relying on the cost figures.
