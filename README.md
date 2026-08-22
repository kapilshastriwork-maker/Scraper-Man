# Startup Hiring Signal Tracker

A **self-healing scraper** that tracks open engineering roles at [Retell AI](https://www.retellai.com/careers), validates every scrape against a frozen baseline, repairs itself through Bright Data's AI healing when the page structure breaks, and publishes a live "who's hiring" board plus a full audit timeline of every decision it made. Built for the WeMakeDevs Scrape-Verse hackathon on Bright Data Scraper Studio — and driven entirely from a coding agent.

Why it matters: scrapers break silently. Sites redesign, selectors go stale, and the data downstream rots without anyone noticing. This project doesn't just scrape — it *detects* its own breakage, *repairs* it through the platform's healing API, *verifies* the repair against real production output before trusting it, and leaves an auditable trail of every decision, including the times it correctly refused to trust its own repair previews.

## What this proves

Two targets, two different proofs. Together they cover both halves of the self-healing story: **the loop works**, and **the loop knows when not to trust itself**.

### (a) The real target: genuine unattended heal → approve → verify → sync

Collector [`c_mt21unzzuq4w8c702`](https://brightdata.com/cp/scrapers/c_mt21unzzuq4w8c702) scrapes Retell AI's Ashby-hosted job board on a 12-hour GitHub Actions schedule with zero human involvement. When Retell posted genuinely new roles after the frozen baseline was captured, the unattended pipeline detected the drift, validated it clean, and synced it to storage:

```json
{"timestamp":"2026-08-21T11:48:31.004Z","trigger":"healthy_run_no_action",
 "validationResultSummary":"pass: true, 33 records vs baseline 31, rules fired: [(none)]",
 "decision":"no_action","syncResult":{"added":2,"updated":31,"closedOut":0}}
```

That entry (from CI run `e93312b`, committed automatically by `github-actions[bot]`) is the concrete evidence: **2 organically-new roles detected, validated, and persisted unattended**, with all prior roles refreshed and none wrongly closed out. The next scheduled run kept working: 37 records, `added: 4` — real-world drift handled continuously while development continued elsewhere in the repo. Full history lives in [`orchestrator/audit-log.jsonl`](./orchestrator/audit-log.jsonl); earlier in the project the same loop survived a real schema-level break and healed itself end-to-end (`healed_and_approved`, see PROGRESS.md Session 6).

### (b) The demo target: an approval gate that catches breakage — and its operator

We own a second target outright: a static careers page deployed to [GitHub Pages](https://kapilshastriwork-maker.github.io/Scraper-Man/demo-page/) (collector `c_mt41tsfb1160modp6z`). In Phase 7 we deliberately redesigned its markup — renamed every class, added a nesting level a real redesign would plausibly add (commit `7fc6214`) — and let the pipeline respond unattended:

1. Production scrape returned **0 records**; full-validation failed loudly.
2. The orchestrator composed a heal prompt, triggered a real heal — then **refused to auto-approve**: the heal's preview arrived wrapped in a shape validation didn't expect. Escalated for human inspection instead of trusting it. *(receipts: `orchestrator/recon/demo-heal-*`, `orchestrator/recon/demo-run-*`)*
3. After a fix to normalize preview samples, it resumed via cached state and escalated **again** — this time because the preview sample was provably truncated by the CLI (a literal `"4 more items"` placeholder inside the JSON). Fail-closed again. *(receipts: `orchestrator/recon/demo-run-6-*`, `state-demo.json` history in git)*
4. A human then overrode the gate and approved manually, based on the same preview evidence. The verification run came back **empty: 0 of 6 records**. **The gate was right; the override was wrong.**
5. The staged heal was formally rejected (`--reject`, receipt in `orchestrator/recon/demo-reject-*`), and the broken page stays broken by design — evidence, not an accident.

This is the point, stated plainly: **preview_result is not a reliable predictor of production behavior on this platform at this record count**, confirmed across multiple collectors and heal attempts. An approval gate that withholds trust from misleading signals — including catching its own operator's incorrect override — is a stronger safety property than an unbroken success reel. That framing is deliberate engineering judgment, not a fallback narrative. The full blow-by-blow is in [PROGRESS.md, Sessions 9–10](./PROGRESS.md).

## Architecture

The extraction itself does **not** live in this repo. It is built and hosted in Bright Data Scraper Studio and driven remotely through the `bdata` CLI. Everything that wraps around extraction lives here:

```
                    ┌─────────────────────────────────────────────┐
                    │   Bright Data Scraper Studio (external)     │
                    │   extraction templates + AI healing engine  │
                    └──────────────┬──────────────────────────────┘
                                   │ bdata scraper run / heal / approve
┌──────────────────────────────────▼──────────────────────────────────────────┐
│ THIS REPO                                                                   │
│                                                                             │
│  scraper/run-cli.ts      thin wrapper: invokes bdata, writes timestamped    │
│                          run files + latest.json (demo path also reshapes   │
│                          platform wrapper output via normalize adapter)     │
│            │                                                                │
│            ▼                                                                │
│  validator/validate.ts   5 rules vs frozen baseline: non_empty_array,       │
│                          required_fields_present, row_count_sanity,         │
│                          url_shape, no_mass_duplication                     │
│            │                                                                │
│            ▼                                                                │
│  orchestrator/orchestrate.ts   state machine: healthy→sync | heal→          │
│                          preview-gate→approve→re-scrape→verify | escalate   │
│            │              (local state.json + append-only audit-log.jsonl)  │
│            ▼                                                                │
│  downstream/db.ts        SQLite (better-sqlite3): upsert/closeout upsert    │
│            │              never deletes; first_seen_at/is_active history    │
│            ▼                                                                │
│  timeline.html + jobs.html   double-clickable audit trail + hiring board     │
│            │                                                                │
│            ▼                                                                │
│  .github/workflows/pipeline.yml   cron every 12h: orchestrate → build       │
│                                   pages → commit artifacts back to the repo │
└─────────────────────────────────────────────────────────────────────────────┘
```

The seam matters: **Scraper Studio owns extraction and value correctness; this repo owns everything downstream of trust** — deciding whether output is sane, whether a proposed heal deserves approval, what gets persisted, and what humans get told about it.

## Targets & what "wired downstream" means

| Target | Collector ID | Purpose |
|---|---|---|
| Real: `jobs.ashbyhq.com/retell-ai` | [`c_mt21unzzuq4w8c702`](https://brightdata.com/cp/scrapers/c_mt21unzzuq4w8c702) | live production target; natural drift |
| Demo: GitHub Pages page we control | `c_mt41tsfb1160modp6z` | controlled-break experiment |
| *(abandoned)* retellai.com marketing shell | `c_mt21dfrd1jpyf7wgrx` | no in-page job data — kept as a record |
| *(abandoned)* original demo collectors | `c_mt38x3t61u0a0c6mll`, `c_mt41d5pczex8zq60n` | superseded during the Phase 7 saga |

"Wired downstream" is concrete: every full-validate PASS upserts records into `downstream/data.db` (SQLite — new URLs inserted with `first_seen_at`, returning URLs refreshed, vanished URLs closed out but **never deleted**), and that database renders into two committed, double-clickable pages:

- [`downstream/jobs.html`](./downstream/jobs.html) — the product: who's hiring right now, with apply links
- [`downstream/timeline.html`](./downstream/timeline.html) — the audit trail: every orchestrator decision, with reasoning and sync counts

## Running it yourself

One-time human setup (browser required): see [`SETUP_CHECKLIST.md`](./SETUP_CHECKLIST.md) — Bright Data signup, promo code, then:

```bash
npx -p @brightdata/cli bdata login --device   # device auth in your browser
npm install                                    # Node 22 (see .nvmrc)
cp .env.example .env                           # optional locally; token comes from
                                               # the cached login or BRIGHTDATA_API_KEY in CI
```

Key commands:

| Command | What it does |
|---|---|
| `npm run orchestrate` | full loop against the real target: scrape → validate → heal/approve if needed → sync |
| `npm run orchestrate:demo` | same loop against the demo target (no DB writes) |
| `npm run validate -- <runFile>` | validate any run file against the baseline |
| `npm run timeline:build && npm run jobs:build` | rebuild the two HTML pages from audit log + DB |
| `npm run audit:view` | one-line-per-entry dump of the real-target audit log |

Test suites (no real API calls): `npm run validate:test`, `npm run orchestrate:test`, `npm run downstream:test`, `npm run demo:test`.

For unattended CI, set a repository secret `BRIGHTDATA_API_KEY`; the workflow ([`.github/workflows/pipeline.yml`](./.github/workflows/pipeline.yml)) runs every 12 hours on schedule (plus manual dispatch) and commits updated artifacts back to `main`.

## What the coding agent generated vs. what was decided by hand

Honest split, since judges ask:

**Decided by hand (human):**
- Target selection and narrowing (3 candidates → 1 real + 1 self-controlled demo)
- The critical pivot diagnosis: retellai.com/careers is a Webflow shell embedding Ashby client-side — scrape the Ashby board instead
- Phase 4 design corrections (branch-(b)/(c) run-file-count invariant, state-vs-audit disagreement ruling)
- Storage engine ratification (better-sqlite3) and the reversal committing `data.db` for CI persistence
- Every provisional/manual trust decision in the Phase 7 saga — including the manual approve that production proved wrong, and the final formal rejection
- All browser-only steps: account setup, device logins, GitHub repo + Pages enablement

**Generated by the coding agent (this repo's contents):**
- All TypeScript: validator (5 rules + fixtures), healing orchestrator (state machine, DI-testable), scraper CLI wrapper, SQLite layer (upsert/closeout semantics), timeline/jobs page builders, demo-output reshape adapter
- All test suites and fixtures (24 assertions across 4 suites, zero live-API tests)
- The GitHub Actions workflow, demo page HTML, and this documentation + the session-by-session PROGRESS.md record

Where the agent made implementation choices along the way (validator thresholds, dependency-injection seams, the narrowly-scoped normalize adapter as a documented exception to the "no local extraction" policy), each choice is recorded with its rationale in [PROGRESS.md Key Decisions](./PROGRESS.md).

## The full story

[`PROGRESS.md`](./PROGRESS.md) is the primary source: phase-by-phase checklist, key decisions with rationale, known issues, and ten session-log entries covering everything above blow-by-blow — including the parts that went sideways and what they proved.
