# Startup Hiring Signal Tracker

A self-healing scraper that tracks open roles at a real startup careers page (Retell AI) and survives two kinds of breakage: natural content drift on the live site, and a deliberate structural redesign on a demo page we fully control. Built for the WeMakeDevs Scrape-Verse hackathon on Bright Data Scraper Studio.

**Project state:** see [`PROGRESS.md`](./PROGRESS.md) — it is the source of truth for current phase, decisions, and cross-session context. Read it first at the start of every session.

## Progress

- [x] Phase 1 — Foundation & target lock-in
- [ ] Phase 2 — Build the base scraper in Scraper Studio
- [ ] Phase 3 — Validator
- [ ] Phase 4 — Healing orchestrator
- [ ] Phase 5 — Downstream + audit timeline
- [ ] Phase 6 — Unattended CI loop + scale
- [ ] Phase 7 — Controlled-break demo, polish, submit

> Phase 1 is marked in progress in `PROGRESS.md` until the human-only `SETUP_CHECKLIST.md` steps are completed.

## Architecture

The actual scraper does **not** live in this repo. It is built and hosted in [Bright Data Scraper Studio](https://brightdata.com) and driven remotely via the `bdata` CLI.

This repo hosts everything that *wraps around* the scraper:

- **Validator** (Phase 3) — checks scraper output against `config/schema.json`
- **Healing orchestrator** (Phase 4) — detects layout-break signatures and triggers re-runs
- **Downstream storage** (Phase 5) — persists valid records and an audit timeline
- **CI loop** (Phase 6) — GitHub Actions running the orchestrator unattended
- **Demo page** (Phase 7) — a GitHub Pages controlled-break practice target

The two targets are locked in `config/targets.json` (1 real site + 1 self-controlled demo site) and the field schema in `config/schema.json`. The "generalizes" story is reframed from "across 3 sites" to "across 2 kinds of breakage": natural content drift on the real site vs. a deliberate structural redesign on the demo site.

## Setup

See [`SETUP_CHECKLIST.md`](./SETUP_CHECKLIST.md).
