# resume-tailor/

**Standalone proof-of-concept:** take a job posting scraped by this repo's self-healing scraper pipeline (the `skills-demo/` target's output) and use an LLM to tailor resume project bullets for it — then splice those bullets into a real Word document without breaking its formatting.

Fully isolated from the scraper/orchestrator/downstream pipeline. Nothing in `scraper/`, `orchestrator/`, `downstream/`, `config/`, `demo-page/`, `skills-demo/`, or `mini-heal-demo/` is used as code — only `skills-demo/baseline-output.json` is **read** as the job-postings data source.

## What it does

1. **Match a job** — `npm run resume:generate -- "<job title>"` finds the matching record (case-insensitive partial match) in `skills-demo/baseline-output.json` and extracts its `skills_required`.
2. **Pick projects via Groq** — your full `experience.md` plus the job's skills go to Groq's chat completions API (`openai/gpt-oss-120b`, strict-mode structured outputs), which returns 2-3 most-relevant projects × 3 tailored first-person bullets each, as guaranteed-valid JSON. Picks print live and are saved to `output/picks-<slug>.json`.
3. **Fill the template** — `fill-template.ts` splices the picks into `template.docx`: the paragraph containing `{{PROJECTS_PLACEHOLDER}}` is replaced by one bold heading paragraph per picked project + one bullet paragraph per bullet, cloning the template's own `<w:pPr>` formatting. The file is edited in place inside the zip (never re-rendered or reformatted), then structurally validated against the original.
4. **Verify visually** — render with LibreOffice headless and confirm only the placeholder region changed.

## Why Groq

Groq offers a free tier and an OpenAI-compatible REST endpoint, so this PoC needs no paid API key and no SDK dependency — just `fetch` + `dotenv`.

- Endpoint: `POST https://api.groq.com/openai/v1/chat/completions`
- Model: `openai/gpt-oss-120b` (verified current against console.groq.com/docs/models)
- Strict JSON via `response_format: json_schema` with `strict: true` (verified against console.groq.com/docs/structured-outputs)

## Setup

1. **API key**: create `.env` in the repo root (copy `.env.example`) with one line:
   ```
   GROQ_API_KEY=<your key>
   ```
   Free keys at https://console.groq.com/keys. Never commit `.env`.
2. **Fill in `experience.md`** with your real projects (format guidance is inside the file). The script refuses to run against the empty skeleton.

## ⚠️ REQUIRED MANUAL STEP: `resume-tailor/template.docx`

This repo deliberately does NOT ship a template. You must create and drop in your real resume yourself:

- Path: `resume-tailor/template.docx` (a normal .docx you edit in Word).
- It MUST contain exactly one paragraph whose visible text includes the literal string `{{PROJECTS_PLACEHOLDER}}` — this marks where the projects section goes.
- It SHOULD contain at least one existing bullet list item ABOVE that placeholder (a "List Paragraph" in Word). That bullet's list formatting is cloned for every generated bullet, so they inherit your numbering/indentation style.
- The placeholder paragraph's own paragraph/run formatting becomes the project-name heading format — so if you want bold headings, make the placeholder text bold in Word.

Without this file, `fill-template.ts` fails loudly with instructions instead of guessing.

## Running

```bash
# stage 1: match job + generate picks via Groq
npm run resume:generate -- "ML Engineer"

# stage 2: fill template.docx + structural validation
npx tsx resume-tailor/fill-template.ts output/picks-ml-engineer.json
```

Stage 2 validates the edited docx against the original (`scripts/validate.py --original`). If validation reports ANY structural error, it stops and reports — no automatic fix attempts.

### Visual verification (requires LibreOffice)

```bash
soffice --headless --convert-to pdf --outdir output resume-tailor/output/tailored-resume-<slug>.docx
```

Then open the PDF/image and confirm: placeholder replaced correctly, everything else on the page unchanged from the original template. LibreOffice must be installed on the machine for this step; the scripts do not attempt any fallback rendering path.

## Bug history: missing section heading + silent formatting loss

Two real bugs surfaced during the first end-to-end runs, both fixed:

- **Missing section heading.** The manual template edit that inserted `{{PROJECTS_PLACEHOLDER}}` also removed the `PROJECTS WORKED ON` section heading (a Heading1 paragraph) that sat above the demo project name it replaced — the first render had projects appearing with no section header. Root cause: human edit error, not script error. Fix: the heading was re-inserted into `template.docx` programmatically, cloned from the EDUCATION heading's actual XML (Heading1 pStyle + purple run color), with the pre-repair template preserved as `template-original-before-repair.docx`.
- **Silent run-formatting loss (rsid regex bug).** `fill-template.ts` captured the placeholder's run formatting with a regex that only matched attribute-less `<w:r>` tags. Word routinely emits `<w:r w:rsidRPr="...">`, so the match failed silently — generated project names lost bold/purple/font/size (`heading rPr: (none)` in the capture log). Fixed to `<w:r\b[^>]*>`; the capture now reports `heading rPr: yes` and rendered output matches the template's project-title style.

Related: the docx unzip/rezip path was also rebuilt after `[Content_Types].xml` was found missing from output (PowerShell's `Expand-Archive`/`Compress-Archive` mishandle `[` `]` in filenames); it now walks the file tree explicitly and zips per-entry with forward-slash names.

## Files

| File | Purpose |
|---|---|
| `generate.ts` | Stage 1: job match + Groq structured-output call → `output/picks-<slug>.json` |
| `fill-template.ts` | Stage 2: splice picks into `template.docx`, validate |
| `scripts/validate.py` | Structural docx validation vs original (XML well-formedness + region-only diff) |
| `experience.md` | Your projects/skills source text (**you fill this in**) |
| `template.docx` | Your resume template (**you provide this**) |
| `output/` | Generated picks + tailored resumes (gitignored artifacts) |
