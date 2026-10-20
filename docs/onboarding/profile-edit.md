# Profile edit (`/profile`)

**Status (2026-10-20):** built on `feat/ui`; server, API and pure UI logic tested; not opened in a browser yet (the soak run was live, so no `npm run dev`).

## How it works

After Finish, the profile lives in `profiles`, `profile_skills`, `custom_skills`, `profile_projects` and `profile_experience` (the `onboarding_steps` rows stay as the Finish-time snapshot and are never edited). `/profile` shows five sections, each with a read view and an **Edit** button:

| Section | Checked with (core `STEP_SCHEMAS`, complete) | Writes |
|---|---|---|
| Basics | `basics` | `profiles`: name, headline, job types, experience, country, time zone |
| Skills | `skills` | replaces the user's `profile_skills` and `custom_skills` |
| Projects & experience | `work` | `profile_projects`, `profile_experience`, `profiles.mention_employers` |
| Rates & filters | `rates` | `profiles`: min rate (minor units), currency, rate type, remote only |
| GitHub | `import` | `profiles.github_username` |

One save is one section. `PUT /api/v1/profile/:section` → `saveProfileSection()` runs in one transaction:

1. Lock the `profiles` row (`FOR UPDATE`): saves of one user take turns, so the count below can't be raced. No profile → `404 NOT_FOUND`.
2. Check the data with the step's complete schema → `400 INVALID_INPUT` with field errors under `data.*`.
3. `expectedVersion` must equal `profiles.profile_version` → else `409 VERSION_CONFLICT` (`details.version`).
4. Read the stored section, normalise both sides (`sectionKey`: keys sorted, skills as a set, project/role order kept, `namesRemoved` ignored). **Equal → `200 { changed: false }`**: no write, no version bump, not counted (also when the week's changes are used up).
5. Count `profile_changes` rows of the last 7 days (database clock). 5 or more → `429 PROFILE_EDIT_LIMIT`, `details: { limit, nextFreeAt }`, `Retry-After` in seconds.
6. Write the section, bump `profile_version` (+1) and `updated_at`, insert a `profile_changes` row (section, new version).

Projects and roles keep their row (and id) when unchanged, even if moved, so `matches.best_project_id` / `best_role_id` still point at them; an edited entry becomes a new row (`planEntries`).

## The weekly limit

**5 changes in any rolling 7 days**, enforced in Postgres (`profile_changes`, migration `0017_profile_changes`), not Redis: it is a rule, not rebuildable data. `nextFreeAt` is when the oldest counted change turns 7 days old. The page shows "3 of 5 changes left this week · One more frees up Thu, Oct 22, 2:05 PM" (in the profile's time zone); with none left the Edit buttons are disabled.

## No re-match

A profile edit **never** calls `requestRematch` (decided 2026-10-20). Matches already in the feed keep the scores from the old profile; posts matched after the edit use the new profile. The matcher reads `profile_version` when it scores a post and writes it on the match, so the bump only fences: a stale snapshot can't overwrite a newer row. The page says this in one line under the allowance.

## API

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/v1/profile` | — | `{ version, timeZone, sections: { basics, skills, work, rates, github }, allowance: { limit, used, remaining, nextFreeAt } }`; 404 before onboarding |
| `PUT /api/v1/profile/:section` | `{ data, expectedVersion }` | `{ changed, version, data, allowance }`; 400 / 404 (no profile or unknown section) / 409 `VERSION_CONFLICT` / 429 `PROFILE_EDIT_LIMIT` |

Both go through `apiRoute()` (session, origin check on PUT, default `api` rate-limit bucket).

## Files

- `apps/web/src/lib/profile-edit.ts`: sections, the limit, `computeAllowance`, `allowanceText`, `sectionKey` (pure; server and browser)
- `apps/web/src/server/profile/service.ts`: `getProfileForEdit`, `saveProfileSection`, `planEntries`
- `apps/web/src/app/api/v1/profile/route.ts`, `[section]/route.ts`
- `apps/web/src/app/(app)/profile/page.tsx`; `apps/web/src/components/profile/profile-editor.tsx`, `use-profile-section.ts`, `profile-state.ts`
- The onboarding step forms were split so both use the same fields: `BasicsFields`, `SkillsFields`, `WorkFields`, `RatesFields` (typed by `FieldsForm` in `step-form-types.ts`). The GitHub field on `/profile` is its own small input (the Import step also handles resumes).
- `packages/db/src/schema.ts` (`profileChanges`, `PROFILE_SECTIONS`), `packages/db/migrations/0017_profile_changes.sql`
- Error code `PROFILE_EDIT_LIMIT` (429) in `server/errors.ts`, its message in `lib/api-errors.ts`

Tests: `lib/profile-edit.test.ts`, `components/profile/profile-state.test.ts`, `server/profile/service.test.ts`, `app/api/v1/profile/profile.test.ts`.

## Decisions

- **The version check uses `profile_version`** (one counter for the whole profile), so a save in another tab refuses this tab's save of any section until it reloads.
- **A no-op save is accepted even at the limit** and answers `changed: false`; the toast says it wasn't counted.
- **No local copy or restore banner** (onboarding has them): each section is a short edit that is saved or cancelled; a dirty section warns before the tab closes.
- **Editing GitHub doesn't start an import**; it only changes the link drafts use.
- `include_unpaid` isn't on this page (onboarding never collected it).

## Known gaps

- Not checked in a real browser yet (desktop and phone).
- A saved field that no longer passes a tightened schema makes that section's next save count as a change even if nothing was touched.
