# Project Progress Log

**Status:** Phase 2 in progress
**Last updated:** 2026-08-21 — Phase 2

## How to use this file (read this first, every session)
- Read this file in FULL before doing any work in a new session.
- At the end of every session, or after finishing any meaningful chunk of work, add a new entry to the Session Log below — do this automatically, don't wait to be asked.
- Keep entries short and factual: what changed, why, what's still open, what's next.
- Anything decided that future sessions must respect (naming, schema, target URLs, tech choices, tradeoffs) goes under Key Decisions, not just buried in the log.

## Current Phase
Phase 2 of 7 — Build the base scraper in Scraper Studio + build (and later deploy) the demo page

## Phase Checklist
- [x] Phase 1 — Foundation & target lock-in
- [ ] Phase 2 — Build the base scraper in Scraper Studio + build & deploy the demo page's actual HTML content to GitHub Pages (not just a placeholder stub) — **in progress** (scraper created, demo page built, deployment deferred — see Known Issues)
- [ ] Phase 3 — Validator
- [ ] Phase 4 — Healing orchestrator
- [ ] Phase 5 — Downstream + audit timeline
- [ ] Phase 6 — Unattended CI loop + scale
- [ ] Phase 7 — Controlled-break demo, polish, submit

> Phase 1 is done. Phase 2 is in progress: the real scraper is created and producing populated output (31 records), the demo page is built locally but not yet deployed (needs a GitHub remote which is deliberately deferred).

## Key Decisions

- **Target sites (locked in `config/targets.json`):**
  1. `https://jobs.ashbyhq.com/retell-ai` — `type: "real"`, Ashby-hosted job board. **Pivot from Session 3:** the originally-locked `https://www.retellai.com/careers` is a Webflow marketing shell with no job data in its own page content — its "Open Positions" section embeds the Ashby board in an iframe. After creating a scraper against it and getting an empty `jobs` array, we pivoted to the actual data source (`jobs.ashbyhq.com/retell-ai`). This is itself a small but real example of the kind of unexpected result that would normally warrant a heal — diagnosed manually here because an empty scrape against a page with no scrapeable content is not a layout break, it's a wrong-data-source error (not healable).
  2. `TBD — GitHub Pages URL` — `type: "demo"`. Static page we fully control, built to mirror the schema of the real target, used exclusively for the deliberate structural-break self-heal demo in Phase 7.
  - Rationale (revised in Session 2, retained): 1 real target + 1 self-controlled demo target. (a) Owning the demo page guarantees a genuine, filmable self-heal event instead of hoping a real site redesigns mid-hackathon. (b) Kept the project focused. (c) Reframed "generalizes" from "across 3 sites" to "across 2 kinds of breakage": natural content drift on the real site vs. a deliberate structural redesign on the demo site.
  - The `targets.json` real target URL needs updating to the Ashby URL — currently still the old retellai.com/careers URL. Tracked in Known Issues / Open Questions.

- **Scraper (Bright Data Scraper Studio):**
  - Active collector ID: `c_mt21unzzuq4w8c702`, target `https://jobs.ashbyhq.com/retell-ai`, created 2026-08-20T21:45:40.607Z. View: https://brightdata.com/cp/scrapers/c_mt21unzzuq4w8c702
  - Field description at creation: `job title, location (remote/onsite/city), and the direct application URL for each open role listed on this job board`
  - Actual output fields returned: `job_title`, `location`, `application_url` (matches v1 schema conceptually but field names differ; Phase 3's validator will alias `job_title`→`role_title` and `application_url`→`job_url`). Also returns bonus `location_type` (e.g. "Applied AI", "On-site"), `product_page_url`, `input` — not in v1 schema but harmless extras.
  - Abandoned collector: `c_mt21dfrd1jpyf7wgrx` (original retellai.com/careers target — returned empty `jobs` array; left on Bright Data as a record, not deleted).
  - Baseline output: `scraper/baseline-output.json` — frozen "known good" reference, 31 records, raw bytes unmodified (UTF-8 no BOM). Phase 3's validator compares future runs against this. Never overwritten.
  - Run outputs: `scraper/runs/<ISO-timestamp>.json` per run + `scraper/runs/latest.json` as a stable mirror, written by `npm run scraper:run` (backed by `scraper/run-cli.ts`). stdout gets only a short summary (record count + timestamp), the full JSON stays in the files.

- **Schema v1 (`config/schema.json`) is deliberately minimal** — only `role_title`, `location`, `job_url` (all string). v1 exists to get a working end-to-end pipeline (scrape → validate → store) first. `planned_v2_fields` (`department`, `employment_type`, `date_posted`) are *reserved in the schema but NOT extracted in v1* — they're staged intentionally for a later self-heal demo where a new field gets added as part of the healing loop.

- **Scraper is NOT in this repo (just the wrapper).** The actual scraper template lives in Bright Data Scraper Studio and is driven via the `bdata` CLI. This repo only hosts the wrapper: `config/scraper.json` (collector metadata), `scraper/run-cli.ts` (orchestration), `scraper/baseline-output.json` (frozen reference), `scraper/runs/` (run history), and later-phase validator + healing + downstream + CI. Do not write local extraction code — extraction belongs in Scraper Studio templates.

- **Tech stack:**
  - Node.js 22 (pinned via `.nvmrc` = `22` and `package.json` `engines.node` = `>=22.0.0`) — but the current dev machine has Node 24; the strict `>=22.0.0` still satisfies.
  - TypeScript (strict, ES2022 / NodeNext), `tsconfig.json` configured.
  - `tsx` (devDependency) runs `.ts` directly without a build step; `@types/node` for typing. `tsc --noEmit` is the typecheck.
  - Real (not placeholder) npm scripts for the scraper as of Phase 2: `scraper:create`, `scraper:run`, `scraper:heal`, `scraper:approve` — all backed by `scraper/run-cli.ts`. `validate`, `orchestrate`, `dev` are still no-op placeholders until their phases.

- **Git policy:** default branch `main`. **No remote yet** — left unset intentionally; the GitHub repo + remote will be wired up manually before Phase 6, when GitHub Actions needs somewhere to run. Do not add a remote or create the GitHub repo in Phases 1-5 unless explicitly asked.

- **No-op commit-only phases:** Phase 1 produced no scraper code, no validation code, no CI — only the scaffold and locked-in targets/schema. Phase 2 produces the real Scraper Studio scraper + the demo page HTML + the run-cli wrapper + baseline output. Each phase's scope is final; do not jump ahead.

- **bdata vs AI agent policy (clarified in Session 3 — superseding the Phase 1 wording):** The Phase 1 wording "The AI agent must not attempt to run `bdata` itself" was scoped specifically to the **device-auth login flow** (`bdata login --device`), which requires a human browser session and cannot be done by the agent. Running `create` / `run` / `heal` / `approve` **against an already-authenticated session** is a different situation — it was always intended to be agent-driven (that is the whole point of the WeMakeDevs Scrape-Verse "driven from your coding agent" criterion). Future sessions: do NOT misread the Phase 1 wording as "always ask the human to run bdata commands." Only the initial `login --device` (and any token refresh that the agent can't recover from) is a human-only step.

## What Exists Right Now

```
ScraperMan/
├── .github/workflows/   # (README stub) Phase 6 — CI workflows
├── .nvmrc               # contains "22" — Node version pin
├── .env.example         # BRIGHTDATA_API_TOKEN= (placeholder, no value)
├── .gitignore           # node_modules, .env, dist, *.log
├── README.md            # project pitch + progress + architecture
├── SETUP_CHECKLIST.md   # 5 human-only setup checkboxes
├── PROGRESS.md          # THIS FILE — cross-session project memory
├── package.json         # name, engines.node>=22, real scraper:* scripts, validate/orchestrate/dev still no-ops
├── package-lock.json    # lockfile (tracked) — added Phase 2 with tsx + @types/node
├── tsconfig.json        # TS strict, ES2022/NodeNext
├── node_modules/        # gitignored
├── config/
│   ├── targets.json     # 2 targets: 1 real (NOTE: still retellai.com/careers URL — needs Ashby update; see Known Issues) + 1 self-controlled demo (TBD GH Pages)
│   ├── schema.json      # v1 fields + planned_v2_fields
│   └── scraper.json     # collectorId c_mt21unzzuq4w8c702, targetUrl, abandonedCollectorIds, fieldDescription
├── scraper/             # Phase 2 — wrapper around the Bright Data scraper
│   ├── README.md        # collector metadata, abandoned note, re-run instructions
│   ├── run-cli.ts       # TS entrypoint backing npm scripts (create/run/heal/approve)
│   ├── baseline-output.json  # FROZEN known-good reference, 31 records, raw bytes unmodified
│   └── runs/            # every npm run scraper:run writes <ISO-timestamp>.json + latest.json
│       ├── 2026-08-20T21-54-36-908Z.json
│       └── latest.json
├── validator/          # (README stub) Phase 3
├── orchestrator/       # (README stub) Phase 4
├── downstream/         # (README stub) Phase 5
├── demo-page/          # static fake careers page (Northwind Labs) — built but NOT deployed
│   ├── index.html      # 6 fictional roles, semantic classes (job-card / job-title / job-location / job-apply-link)
│   └── README.md       # Phase 7 controlled-break demo purpose
└── docs/
    └── ARCHITECTURE.md  # section headers only, to be filled in later phases
```

## Known Issues / Open Questions

- **`config/targets.json` real-target URL is stale.** It still lists `https://www.retellai.com/careers` but the actual scraper now points at `https://jobs.ashbyhq.com/retell-ai` (recorded correctly in `config/scraper.json`). `targets.json` needs updating in Phase 3 (or sooner) to match — and the `notes` field should reflect the iframe/embed pivot rationale. Not urgent because `scraper.json` is what the run script actually reads.

- **Demo page is built locally but not deployed** — needs a GitHub repo + remote + Pages enabled in Settings before Phase 7. Manual step, not agent-doable. The `targets.json` `type: "demo"` URL stays `TBD — GitHub Pages URL` until then.

- **SETUP_CHECKLIST.md library-check step still pending.** The other 4 of 5 steps functionally verified during Phase 2: `bdata login --device`'s token was already cached (so create/run/heal/approve work without browser interaction), `bdata --version` returned `0.3.5`, Bright Data signup implicitly worked (we created collectors). The remaining step is purely observational: visit brightdata.com/cp/scrapers/browse and confirm no maintained library scraper already covers `jobs.ashbyhq.com/retell-ai` (or the Ashby platform generally). Non-blocking — we've already created our own — but should still be done for the checklist's completeness.

- **GitHub remote** — intentionally unset. Open question for later (before Phase 6): the GitHub repo name + remote URL will be chosen by the human. Phase 7's demo-page deployment also depends on this.

- **Run-cli details:** `npm run scraper:run` captures bdata's stdout (JSON) and writes `runs/<ts>.json` + `runs/latest.json`. Polling progress (`Polling (attempt N/600)`) is shown to stderr. Average run takes ~60 polls (~1-2 min). If a future run hits a 600-attempt timeout that's the signal a heal is needed.

- **tsconfig `include`** currently covers `scraper/`, `validator/`, `orchestrator/`, `downstream/`, `config/` — may need to broaden as real code lands in later phases. Already verified: `tsc --noEmit` passes with `scraper/run-cli.ts` in scope.

- **`run-cli.ts` uses `process.cwd()`** for REPO_ROOT — relies on npm scripts always running with cwd = repo root. If we ever invoke it from another directory (e.g. CI step from a different repo root), paths will break. Acceptable for now, noted for Phase 6.

## Session Log (most recent entry first)

### Session 3 — Phase 2 (base scraper + demo page)
- **Real scraper pivot.** Originally created `c_mt21dfrd1jpyf7wgrx` against `https://www.retellai.com/careers`; `bdata scraper run` returned an empty `jobs` array. Diagnosed (via the user's input) that retellai.com/careers is a Webflow marketing shell whose "Open Positions" section embeds the actual Ashby board in an iframe — no job data on the page itself to heal toward. Created a new collector `c_mt21unzzuq4w8c702` against `https://jobs.ashbyhq.com/retell-ai`; `bdata scraper run` returned 31 populated records with fields `job_title`, `location`, `application_url` (plus bonus `location_type`, `product_page_url`, `input`). Close to v1 schema (`role_title`/`location`/`job_url`) — Phase 3 validator will alias the differing names.
- **Frozen baseline.** Saved `scraper/baseline-output.json` as the raw unmodified JSON from the successful run (UTF-8 no BOM, 11,341 bytes, 31 records). This is the "known good" reference Phase 3 will compare against. Stripped PowerShell's UTF-16/BOM artifacts from the file twice to get clean bytes.
- **Real npm scripts (no longer no-ops).** Wrote `scraper/run-cli.ts` (TS, ~120 lines) and replaced the placeholder `scraper:*` scripts in `package.json` with real ones: `scraper:create` (re-runs create against `config/scraper.json`'s targetUrl for reproducibility), `scraper:run` (reads collectorId + targetUrl, runs `bdata scraper run`, captures stdout JSON, writes `scraper/runs/<ISO-timestamp>.json` + mirrors to `scraper/runs/latest.json`, prints short summary to stdout, never touches baseline), `scraper:heal -- "<reason>"` (`bdata scraper heal <id> "<reason>"`), `scraper:approve` (`bdata scraper approve <id>`). Added `tsx` + `@types/node` devDeps. `tsc --noEmit` passes. Smoke-tested `npm run scraper:run` end-to-end (wrote `2026-08-20T21-54-36-908Z.json` + `latest.json`, 31 records, baseline untouched).
- **Demo page.** Built `demo-page/index.html` — static, no framework, minimal inline CSS, fictional company "Northwind Labs", 6 fictional roles mirroring the real target's shape (mix of Remote + SF Bay + London), semantic classes `job-card` / `job-title` / `job-location` / `job-apply-link`. This is the clean "before" state Phase 7 will mutate to simulate a redesign. Updated `demo-page/README.md` with the page's purpose. NOT deployed (no GitHub remote yet — deferred).
- **Docs.** Rewrote `scraper/README.md` with collector metadata table, abandoned collector note, file responsibilities, re-run instructions. Stripped UTF-8 BOMs from `package.json` / `tsconfig.json` / `config/targets.json` / `config/schema.json` / `config/scraper.json` — `Set-Content -Encoding utf8` had added BOMs that broke tsx parsing of `package.json`.
- **PROGRESS.md updates.** Clarified (not reversed) the bdata policy under Key Decisions: Phase 1's "AI must not run bdata" was scoped to the device-auth login flow only; create/run/heal/approve against an already-authenticated session was always intended to be agent-driven (the hackathon's "driven from your coding agent" criterion). Marked Phase 2 in progress. Added `targets.json` stale URL as a Known Issue (it still lists retellai.com/careers; `scraper.json` has the real Ashby URL).

- **Next:** Phase 3 — build the validator against `scraper/baseline-output.json`. First step should be to fix `config/targets.json` to point at `https://jobs.ashbyhq.com/retell-ai` and update the note text to reflect the iframe/embed pivot. Then write the validator that aliases `job_title`→`role_title` and `application_url`→`job_url`, compares each run against the baseline, and surfaces records that look structurally suspect (the input the Phase 4 healing orchestrator will act on).

### Session 2 — Phase 1 (target narrowing)
- Narrowed `config/targets.json` from 3 real targets down to **1 real + 1 self-controlled demo**: Retell AI (real, `type: "real"`) + a TBD GitHub Pages demo page (`type: "demo"`). Removed the Ashby/Linear and Greenhouse/Kalshi entries entirely.
- Rationale (recorded under Key Decisions): (a) owning the demo page guarantees a genuine, filmable self-heal event rather than hoping a real site redesigns mid-hackathon; (b) keeps the project focused; (c) reframes the "generalizes" claim from "across 3 sites" to "across 2 kinds of breakage" — natural content drift (real) vs. deliberate structural redesign (demo).
- Updated README.md pitch & Architecture prose, and trimmed the SETUP_CHECKLIST.md scraper-library check step to just the Retell URL (the demo page won't have a Scraper Studio library scraper).
- Updated the Phase 2 checklist note: Phase 2 now includes building and deploying the demo page's actual HTML content to GitHub Pages, not just placeholder-stubbing it.

- **Next:** Phase 2 will build and deploy the demo page's HTML content in addition to creating the Scraper Studio scraper. Commit message: `Narrow targets: 1 real site + 1 self-controlled demo site`.

### Session 1 — Phase 1
- Scaffolded the full repo per the Phase 1 plan: `config/`, four empty module dirs (`scraper/`, `validator/`, `orchestrator/`, `downstream/`), `.github/workflows/`, `demo-page/`, `docs/`.
- Locked the **three target URLs** in `config/targets.json` with ATS notes (custom / Ashby / Greenhouse) — chosen to span three heterogeneous layout families so the healing claim generalizes.
- Locked **schema v1** (`role_title`, `location`, `job_url`) in `config/schema.json` and reserved `planned_v2_fields` (`department`, `employment_type`, `date_posted`) for a later self-heal demo — deliberately NOT built in v1.
- Added `package.json` (name `startup-hiring-signal-tracker`, `engines.node >=22.0.0`, six no-op placeholder npm scripts) and `tsconfig.json` (strict, ES2022/NodeNext). Pinned Node 22 via `.nvmrc`.
- Wrote README.md (pitch, progress checklist, architecture), SETUP_CHECKLIST.md (5 human-only steps), and PROGRESS.md (this file).
- Stubs/README only in every later-phase module — no scraper, validator, orchestrator, CI, or downstream code written (correct for Phase 1).
- Ran `git init -b main`, staged everything, committed as `Phase 1: project foundation and target lock-in`.

- **Next:** the human completes the 5 manual steps in `SETUP_CHECKLIST.md` (signup, promo code, `bdata login --device`, scraper-library check, `bdata --version`). Once those are checked off, mark Phase 1 complete and begin Phase 2 in Scraper Studio via the `bdata` CLI — first milestone is creating the Bright Data Collector, then recording its Collector ID into `scraper/`.
