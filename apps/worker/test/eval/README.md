# Resume eval

Measures how well the resume pipeline (`runResumePipeline`) fills in a profile, against hand-labelled resumes. It calls the real Vertex AI models, so it is not part of `npm test` (CI only runs the scoring and fixture-format tests).

## What it measures

Per resume and in total:

- **Skill precision**: suggested taxonomy skills that are in `mustSkills` or `maySkills`, over all suggested skills.
- **Skill recall**: `mustSkills` found, over all `mustSkills`.
- **Category accuracy**: Jaccard overlap of expected and suggested job types.
- **Level accuracy**: experience level exactly right.
- **Must-not violations**: skills from `mustNotSkills` that appeared (including the prompt-injection resume).
- **Cost** (from the `onAttempt` usage) and **latency** (p50 and max).

`--baseline` also runs one single-call prompt (all three tasks together) on the smart model with the same thinking setting, the summed output budget (2 200 tokens), the same 20 s deadline and one retry, so you can see whether the three-step pipeline earns its cost.

## Fixtures

`fixtures/NN-name.txt` is a synthetic resume (no real personal data; example.com emails only). Next to it, `NN-name.expected.json`:

```json
{
  "categories": ["development"],
  "experienceLevel": "experienced",
  "mustSkills": ["typescript", "react"],
  "maySkills": ["javascript"],
  "mustNotSkills": ["unity"]
}
```

`mustSkills` and `maySkills` are taxonomy skill ids. `maySkills` is optional: extra skills that are fine to suggest and not required. `mustNotSkills` may also be a skill name (custom skills are checked too). `fixtures.test.ts` checks every fixture's format and that all 12 job types are covered.

## Running

1. `gcloud auth application-default login`
2. In `apps/worker/.env.local` set `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`.
3. From the repo root: `npm run eval -w @redlance/worker` (add `-- --baseline` for the comparison).

## Private resumes

Put real resumes, anonymised and with the owner's consent, in `private/` using the same `.txt` + `.expected.json` format. The folder is gitignored and is loaded automatically.

## LangSmith (opt-in)

`LANGSMITH_TRACING=true` (plus your LangSmith API key) traces each model call. Privacy caveat: traces contain the full resume text and model output, so only the committed synthetic fixtures are traced; `private/` resumes are never sent. Production never uses LangSmith.
