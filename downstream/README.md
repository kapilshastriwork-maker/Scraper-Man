# downstream/

Holds the **downstream storage layer + human-readable snapshots** (Phase 5): a SQLite DB
that stores validated scraped jobs, plus two self-contained static HTML pages (an audit
timeline and a "who's hiring" list) generated from the DB and the orchestrator's audit
log.

## What's in here

- `db.ts` — the storage layer. Exports `initDb(dbPath)`, `syncJobs(dbPath, records,
  runTimestamp)`, and `getActiveJobs(dbPath)`. `syncJobs` is idempotent upsert+closeout
  and returns `{ added, updated, closedOut }` counts.
- `run-sync.ts` — backs `npm run downstream:sync`. Full-validates a run file (default
  `scraper/runs/latest.json`, overridable via `npm run downstream:sync -- <path>`)
  against the baseline; only on `PASS` does it open the DB and call `syncJobs`. On FAIL
  it prints the diff and exits non-zero **without touching the DB** — unvalidated data
  never reaches storage.
- `build-timeline.ts` — backs `npm run timeline:build`. Reads
  `orchestrator/audit-log.jsonl` and emits `timeline.html` (reverse-chronological,
  self-contained, inline CSS, no framework — opens correctly by double-clicking).
- `build-jobs-page.ts` — backs `npm run jobs:build`. Reads `is_active=1` rows from the
  DB and emits `jobs.html` (a public-facing "who's hiring" list — title, location, apply
  link). This is the actual downstream product the Collector ID's scraped data is "for."
- `run-tests.ts` — backs `npm run downstream:test`. Uses a fresh temp DB per test; never
  touches the real `downstream/data.db`.
- `data.db` — the SQLite DB itself. **Tracked** (see below).
- `timeline.html`, `jobs.html` — the two static HTML snapshots. **Tracked**, regenerable
  via the build scripts above. Re-regenerating and recommitting them after each
  orchestrate cycle is expected behavior over the coming phases.

## Why data.db is tracked

`downstream/data.db` is the **sole carrier of `first_seen_at` / `is_active` history** between
scheduled CI runs. GitHub Actions runners are stateless and there is no external database in
this stack; committing the DB is what makes that history survive across workflow executions.
The file is small enough to version and is regenerated on every successful run, so merge
conflicts are not a practical concern.

## Storage schema

The `jobs` table:

| column            | type | notes |
|-------------------|------|-------|
| `application_url` | TEXT PRIMARY KEY | stable per-role identifier (Ashby's per-role UUID URL) |
| `job_title`       | TEXT | required field |
| `location`        | TEXT | required field |
| `location_type`   | TEXT | optional ("On-site", "Applied AI", ...) |
| `product_page_url` | TEXT | optional |
| `first_seen_at`   | TEXT | ISO timestamp this URL was first seen by a PASS-ing run |
| `last_seen_at`    | TEXT | ISO timestamp of the most recent PASS-ing run that still listed this URL |
| `is_active`       | INTEGER | 1 = currently open, 0 = no longer in the latest run |
| `department`      | TEXT NULL | reserved for the planned v2 schema extension; NULL in v1 data |

`department` is intentionally NULL today — the live Ashby page doesn't expose `department`
per role (the heal template synthesized it in preview, but production scrapes do not
include it; see PROGRESS.md Phase 4 Session 6 "preview vs production drift"). The column
exists so a future schema extension doesn't require a destructive migration.

## syncJobs semantics

- **New URL in this run** → INSERT with `first_seen_at = last_seen_at = runTimestamp`,
  `is_active = 1`. Counted as `added`.
- **Existing URL, still in this run** → UPDATE non-key fields, set `last_seen_at =
  runTimestamp`, `is_active = 1`. Counted as `updated`. `first_seen_at` is preserved.
- **Existing URL, NOT in this run** → `is_active` flipped to 0. Counted as `closedOut`.
  The row is **NEVER deleted** — a job disappearing is real signal (role filled or
  pulled), not an error, and we want to keep its first/last-seen history for the audit
  timeline.

Everything runs inside a single transaction per `syncJobs` call, so a crash mid-sync
cannot leave the DB partially updated.

## How to rebuild the DB from scratch

Either:

1. Run a full orchestrate cycle (`npm run orchestrate`) — the orchestrator calls
   `syncToDownstream` automatically on every full-validate PASS, populating the DB. Or,
2. Sync any existing run file directly:

   ```
   npm run downstream:sync
   # or against a specific run file:
   npm run downstream:sync -- scraper/runs/2026-08-20T22-31-02-334Z.json
   ```

   Only runs that PASS validation against `scraper/baseline-output.json` will sync —
   unvalidated data is rejected before the DB is opened.

After syncing, regenerate the HTML snapshots:

```
npm run timeline:build
npm run jobs:build
```
