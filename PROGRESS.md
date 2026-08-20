# Project Progress Log

**Status:** Phase 1 in progress
**Last updated:** 2026-08-20 — Phase 1

## How to use this file (read this first, every session)
- Read this file in FULL before doing any work in a new session.
- At the end of every session, or after finishing any meaningful chunk of work, add a new entry to the Session Log below — do this automatically, don't wait to be asked.
- Keep entries short and factual: what changed, why, what's still open, what's next.
- Anything decided that future sessions must respect (naming, schema, target URLs, tech choices, tradeoffs) goes under Key Decisions, not just buried in the log.

## Current Phase
Phase 1 of 7 — Foundation & target lock-in

## Phase Checklist
- [x] Phase 1 — Foundation & target lock-in
- [ ] Phase 2 — Build the base scraper in Scraper Studio
- [ ] Phase 3 — Validator
- [ ] Phase 4 — Healing orchestrator
- [ ] Phase 5 — Downstream + audit timeline
- [ ] Phase 6 — Unattended CI loop + scale
- [ ] Phase 7 — Controlled-break demo, polish, submit

> Phase 1 repo scaffold is complete and committed. It stays "in progress" until the human-only `SETUP_CHECKLIST.md` steps are completed (Bright Data account, promo code, device login, scraper-library check, `bdata --version`).

## Key Decisions

- **Target sites (locked in `config/targets.json`):**
  1. `https://www.retellai.com/careers` — custom-built page on the company's own domain, NOT a third-party ATS.
  2. `https://jobs.ashbyhq.com/Linear` — Ashby ATS, JavaScript-rendered SPA.
  3. `https://job-boards.greenhouse.io/kalshi` — Greenhouse ATS, traditional server-rendered.
  - Rationale: these three deliberately span heterogeneous layout / ATS families (custom, JS-SPA, server-rendered). The whole project's claim is that self-healing *generalizes*, so the targets must not all share a single platform. A one-site lucky fix would invalidate the demo.

- **Schema v1 (`config/schema.json`) is deliberately minimal** — only `role_title`, `location`, `job_url` (all string). v1 exists to get a working end-to-end pipeline (scrape → validate → store) first. `planned_v2_fields` (`department`, `employment_type`, `date_posted`) are *reserved in the schema but NOT extracted in v1* — they're staged intentionally for a later self-heal demo where a new field gets added as part of the healing loop.

- **Scraper is NOT in this repo.** The actual scraper lives in Bright Data Scraper Studio and is driven via the `bdata` CLI. This repo only wraps around it (validator, healing orchestrator, CI, downstream). Do not write local extraction code — extraction belongs in Scraper Studio templates.

- **Tech stack:**
  - Node.js 22 (pinned via `.nvmrc` = `22` and `package.json` `engines.node` = `>=22.0.0`)
  - TypeScript (strict, ES2022 / NodeNext), `tsconfig.json` configured
  - Placeholder npm scripts only in Phase 1: `scraper:create`, `scraper:run`, `scraper:heal`, `validate`, `orchestrate`, `dev` — all no-ops until later phases.

- **Git policy:** default branch `main`. **No remote yet** — left unset intentionally; the GitHub repo + remote will be wired up manually before Phase 6, when GitHub Actions needs somewhere to run. Do not add a remote or create the GitHub repo in Phases 1-5 unless explicitly asked.

- **No-op commit-only phases:** Phase 1 produces no scraper code, no validation code, no CI — only the scaffold and locked-in targets/schema. Do not jump ahead in any phase.

- **Human-only steps:** Bright Data signup, promo/credit application, `bdata login --device` authorization, scraper-library check, and `bdata --version` confirmation are all manual and tracked in `SETUP_CHECKLIST.md`. The AI agent must not attempt to run `bdata` itself or sign up for anything — those require a human browser session.

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
├── package.json         # name, engines.node>=22, no-op placeholder scripts
├── tsconfig.json        # TS strict, ES2022/NodeNext
├── config/
│   ├── targets.json     # 3 seed URLs + ATS notes (locked)
│   └── schema.json      # v1 fields + planned_v2_fields
├── scraper/            # (README stub) Phase 2 stores Collector ID here
├── validator/          # (README stub) Phase 3
├── orchestrator/       # (README stub) Phase 4
├── downstream/         # (README stub) Phase 5
├── demo-page/          # (README stub) Phase 7 — controlled-break target
└── docs/
    └── ARCHITECTURE.md  # section headers only, to be filled in later phases
```

## Known Issues / Open Questions

- **SETUP_CHECKLIST.md (all 5 steps pending)** — human-only; AI must not attempt. Until these are done, Phase 1 stays "in progress".
- **GitHub remote** — intentionally unset. Open question for later (before Phase 6): the GitHub repo name + remote URL will be chosen by the human.
- **Bright Data Collector ID** — not yet known; will be created in Phase 2 inside Scraper Studio and recorded into `scraper/`.
- **tsconfig `include`** currently covers `scraper/`, `validator/`, `orchestrator/`, `downstream/`, `config/` — may need to broaden as real code lands in later phases.

## Session Log (most recent entry first)

### Session 1 — Phase 1
- Scaffolded the full repo per the Phase 1 plan: `config/`, four empty module dirs (`scraper/`, `validator/`, `orchestrator/`, `downstream/`), `.github/workflows/`, `demo-page/`, `docs/`.
- Locked the **three target URLs** in `config/targets.json` with ATS notes (custom / Ashby / Greenhouse) — chosen to span three heterogeneous layout families so the healing claim generalizes.
- Locked **schema v1** (`role_title`, `location`, `job_url`) in `config/schema.json` and reserved `planned_v2_fields` (`department`, `employment_type`, `date_posted`) for a later self-heal demo — deliberately NOT built in v1.
- Added `package.json` (name `startup-hiring-signal-tracker`, `engines.node >=22.0.0`, six no-op placeholder npm scripts) and `tsconfig.json` (strict, ES2022/NodeNext). Pinned Node 22 via `.nvmrc`.
- Wrote README.md (pitch, progress checklist, architecture), SETUP_CHECKLIST.md (5 human-only steps), and PROGRESS.md (this file).
- Stubs/README only in every later-phase module — no scraper, validator, orchestrator, CI, or downstream code written (correct for Phase 1).
- Ran `git init -b main`, staged everything, committed as `Phase 1: project foundation and target lock-in`.

- **Next:** the human completes the 5 manual steps in `SETUP_CHECKLIST.md` (signup, promo code, `bdata login --device`, scraper-library check, `bdata --version`). Once those are checked off, mark Phase 1 complete and begin Phase 2 in Scraper Studio via the `bdata` CLI — first milestone is creating the Bright Data Collector, then recording its Collector ID into `scraper/`.
