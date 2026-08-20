# scraper/

This directory holds the local wrapper around the scraper that lives in Bright Data Scraper Studio (driven via the `bdata` CLI). **No extraction logic lives here** — extraction belongs to the Scraper Studio template. This directory only orchestrates run/heal/approve and persists the raw outputs.

## Collector

| field | value |
| --- | --- |
| collector_id | `c_mt21unzzuq4w8c702` |
| target URL | https://jobs.ashbyhq.com/retell-ai |
| created_at | 2026-08-20T21:45:40.607Z |
| field description used at creation | `job title, location (remote/onsite/city), and the direct application URL for each open role listed on this job board` |
| v1 schema fields (declared) | `role_title`, `location`, `job_url` |
| actual scraper output fields | `job_title`, `location`, `application_url` (plus bonus `location_type`, `product_page_url`, `input`) |
| view_url | https://brightdata.com/cp/scrapers/c_mt21unzzuq4w8c702 |

> The field names Bright Data's AI chose (`job_title`, `application_url`) differ slightly from the v1 schema (`role_title`, `job_url`). Phase 3's validator will normalize or alias these — that mapping decision is recorded there, not here.

## Abandoned collector

- `c_mt21dfrd1jpyf7wgrx` — original target `https://www.retellai.com/careers` (Retell's own domain). Returned an empty `jobs` array: that URL is a Webflow marketing shell whose "Open Positions" section embeds a third-party Ashby board in an iframe and has no job data in its own page content. Not deleted from Scraper Studio — kept as a record of this iteration.

## Files

- `run-cli.ts` — TypeScript entrypoint backing the four npm scripts. Reads `config/scraper.json` for the collector ID and target URL.
- `baseline-output.json` — **frozen "known good" reference**, the raw unmodified JSON returned by the first successful run on 2026-08-20 (31 records). Phase 3's validator compares future runs against this. Never overwritten.
- `runs/` — directory of timestamped run outputs and `latest.json`. Each future `npm run scraper:run` writes `<ISO-timestamp>.json` here and also mirrors the same content to `runs/latest.json` so later phases (orchestrator, audit timeline) have a stable path.

## Re-running

```bash
npm run scraper:run
```

This invokes `bdata scraper run c_mt21unzzuq4w8c702 https://jobs.ashbyhq.com/retell-ai`, captures the raw JSON, and writes it to both `scraper/runs/<ISO-timestamp>.json` and `scraper/runs/latest.json`. A short summary (record count + timestamp) is printed to stdout — the full JSON dump is kept in files only, to keep the terminal readable.

Other commands (defined in `package.json`):

```bash
npm run scraper:create           # re-runs the create command against current targetUrl (reproducibility)
npm run scraper:heal -- "<reason>"   # triggers bdata scraper heal with a reason string
npm run scraper:approve         # approve the current collector in Scraper Studio
```
