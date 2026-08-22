# demo-page/

**Purpose:** a self-controlled target used for the **Phase 7 self-healing demos** — first the extraction-shape saga documented below (Phase 7 Part A), later the deliberate controlled-break demo.

This page is a static fake startup careers page (fictional company "Northwind Labs") that mirrors the schema of the real target — each listing exposes a job title, a location, and an "Apply" link. It is **deployed** to GitHub Pages:

> **Live URL:** https://kapilshastriwork-maker.github.io/Scraper-Man/demo-page/

## Markup (current)

Commit `4317f12` restructured the listing markup from the original `<article class="job-card">` design to a list-based structure that the Bright Data platform can extract reliably:

```html
<section class="open-roles">
  <ul class="roles">
    <li class="role">
      <h3 class="job-title">…</h3>
      <p class="job-location">…</p>
      <a class="job-apply-link" href="…">Apply</a>
    </li>
    … ×6
  </ul>
</section>
```

Why: against the original `article.job-card` markup, the platform extracted only the FIRST record (1 of 6 roles), and two heal attempts both converged on that same first-record-only result despite prompts explicitly saying "extract all 6, one record per card". Moving to `<ul class="roles">/<li class="role">` fixed multi-record extraction immediately (6/6 records, value-perfect). The inner semantic classes (`job-title` / `job-location` / `job-apply-link`) are unchanged — in the upcoming controlled-break demo these are exactly what gets renamed/restructured on purpose.

## Raw vs normalized output — why both exist

The platform fixed multi-record extraction but introduced a *wrapper-shape* problem it refuses to fix via prompting (see `normalize-demo-output.ts` header for full evidence): production output always comes back wrapped and space-keyed regardless of create/heal prompt wording:

- **`demo-raw-output.json`** — the RAW, unmodified production output from the live collector (`c_mt41tsfb1160modp6z`): `[{"job_listings":[{…"job title"…"application url"…}],"input":{…}}]`. Kept permanently as evidence of the platform behavior that motivates the adapter.
- **`demo-baseline-output.json`** — the NORMALIZED flat 6-record array (`job_title`/`location`/`application_url` per element) matching `config/schema.json`. This is the frozen known-good reference the validator compares demo runs against. Never overwritten.

Both exist because the gap between them IS the finding: values extracted correctly every time; shape never matched the schema.

## `normalize-demo-output.ts` — reshape adapter (not extraction)

A narrowly-scoped adapter that converts raw platform output into the flat schema shape: unwraps the single `{job_listings}` wrapper object and aliases space-keyed names to schema keys. Hard rules:

- Performs ZERO extraction — no HTML parsing, no selectors, no decisions about what counts as a role. Only reshapes values the platform already extracted correctly.
- Throws loudly on any unrecognized shape rather than silently returning partial data; passes through an already-flat array untouched.
- Used ONLY on the `--target=demo` path (`scraper/run-cli.ts`, `orchestrator/orchestrate.ts`). The real target's pipeline never touches this file.
- Direct CLI: `npx tsx demo-page/normalize-demo-output.ts <rawInput.json> [output.json]`

Policy note: the project rule is "no local extraction code — extraction belongs in Scraper Studio." All extraction AND all value-correctness work was genuinely done by Scraper Studio (6/6 correct values on four independent attempts); only key-renaming and unwrapping happen here. That makes this presentation-layer mapping, not extraction.

## `demo-runs/`

Run history for the demo target, written by `npm run scraper:run -- --target=demo`: one `<ISO-timestamp>.json` per run plus a `latest.json` mirror. Files here are already normalized (run-cli applies the adapter before writing), so validation downstream always sees the flat shape. stdout shows a short summary; full JSON stays in the files.
