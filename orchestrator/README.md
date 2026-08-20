# orchestrator/

Holds the **self-healing loop** (Phase 4): run the scraper (via `bdata`), validate the output, detect layout-break signatures, decide whether a heal is warranted, trigger a heal against Bright Data, preview-validate the staged result, and either approve it (auto) or escalate to a human.

## Files

- `orchestrate.ts` — the orchestration flow + DI seam. Implement `Services` (`runScraper`, `healScraper`, `approveScraper`) and pass to `orchestrate({ services })` to run against fixtures without touching the real `bdata` CLI.
- `compose-heal-prompt.ts` — turns a `ValidationResult.diff` array into a single plain-language paragraph for `bdata scraper heal`. Not a `JSON.stringify` of the diff — the heal AI wants natural language.
- `seed-state-from-recon.ts` — manual, occasional-use CLI to seed `state.json` from a captured heal-output file (see "state:seed" below).
- `view-audit-log.ts` — reads the JSONL audit log and prints a one-line-per-entry timeline (throwaway-simple; Phase 5 will improve it).
- `run-tests.ts` — fixture-based tests for `composeHealPrompt`, `validate(preview)` skip behavior, and the approve vs escalate decision logic. No real `bdata` calls.
- `state.json` — local source of truth for collector state (`lastKnownStatus`, `lastHealPreviewResult`, `lastHealPrompt`). Created by `state:seed` or by `orchestrate()` itself after a heal. `orchestrate()` treats a missing `state.json` as a clean state (no pending heal) — it does NOT auto-scan for one.
- `audit-log.jsonl` — append-only JSONL of every orchestrate run: one JSON object per line. Entry shape: `{ timestamp, trigger, validationResultSummary, healPromptSent, collectorStateBefore, collectorStateAfter, previewResultSummary (first 2 records), decision, reasoning }`.
- `recon/heal-raw-output-*.txt` — the raw captured output of the Phase 4 recon heal call (kept as a record; not parsed at orchestrate runtime after the design fix).

## npm scripts

- **`npm run orchestrate`** — runs `orchestrate.ts` against the real `bdata` CLI (manual trigger; Phase 6 wires this into CI cron). Reads `config/scraper.json` + `scraper/baseline-output.json` + `orchestrator/state.json`.
- **`npm run state:seed -- <reconFile> <stateFile> [-- --force]`** — only needed if you have a real pending heal captured outside the normal `orchestrate()` flow and want to seed it into `state.json` without re-triggering the heal call. Refuses to overwrite an existing `<stateFile>` unless `--force` is passed. Exits non-zero if the recon file's heal `status` is anything other than `awaiting_approval`.
- **`npm run audit:view`** — prints the audit log timeline to stdout.

## Flow

`orchestrate()` follows branches (a)–(g):

- **(a)** Read `state.json`.
- **(b)** If `lastKnownStatus === "awaiting_approval"` AND `lastHealPreviewResult` is populated: reuse the stored preview and jump to (d). **Note:** branch (b) skips branch (c)'s fresh run when a pending heal is already found. Run-file count under `scraper/runs/` varies by which branch fired: branch (b)→(e) produces ONE new run file (the post-approve confirmation), while branch (c)→(e) produces TWO (the initial break-detecting run + the post-approve confirmation).
- **(c)** Else: run the real scraper, full-validate against baseline. Pass → `healthy_run_no_action`. Fail → compose heal prompt, call `bdata scraper heal`, persist state, continue.
- **(d)** preview-validate the `preview_result` in `'preview'` mode (skips `row_count_sanity` and `no_mass_duplication` — those rules are population-scale only).
- **(e)** If preview passes: approve (`bdata scraper approve`), re-run the real scraper, full-validate the fresh output. Pass → `healed_and_approved`. Unexpected fail → escalate (no loop/retry).
- **(f)** If preview fails: do NOT approve or reject; leave collector in `awaiting_approval`; log `healed_and_escalated`.
- **(g)** Every branch writes exactly one JSONL audit entry.

## state-tracking approach

`bdata scraper` has no `status`/`get` subcommand (verified via `bdata scraper --help`), so we maintain `state.json` locally as the source of truth for "is there already a pending heal." Seeding from a captured recon output is a manual, explicit step — core `orchestrate()` logic never does implicit filesystem discovery outside its `statePath`.
