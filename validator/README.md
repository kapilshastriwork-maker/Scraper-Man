# validator/

Holds the **rule-based validator** (Phase 3) that checks a scraper run's output for layout-break signatures and natural-drift tolerance. It consumes raw JSON (a Bright Data scraper run) and a frozen baseline, and returns a binary pass/fail result whose `diff` array the Phase 4 healing orchestrator will read to auto-compose `bdata heal` prompts.

## Files

- `validate.ts` — pure exported function `validate(runOutput, baseline) => ValidationResult`. No I/O, no side effects. The single source of truth for what counts as "broken."
- `run-validate.ts` — CLI entrypoint backing `npm run validate`. Loads `scraper/baseline-output.json` (fixed) and a run file (default `scraper/runs/latest.json`, overridable via CLI arg). Prints `PASS (n records)` on pass; full diff details + exit 1 on fail.
- `run-tests.ts` — CLI entrypoint backing `npm run validate:test`. Runs `validate()` against every fixture in `test-fixtures/`, asserts expected pass/fail + exact failing-rule names per fixture, exits non-zero if any assertion is wrong.
- `test-fixtures/` — three fixtures (see below).
- `README.md` — this file.

## `validate()` signature

```ts
type ValidationResult = {
  pass: boolean;
  recordCount: number;
  baselineCount: number;
  diff: Array<{
    rule: string;            // one of the five rule names below
    severity: "fail";
    message: string;         // human-readable explanation
    examples?: unknown[];     // up to 3 example broken records, for required_fields_present
  }>;
};
```

## The five rules

Each rule appends to `diff` when violated. `pass` is true iff `diff.length === 0`.

| # | rule | what it checks | threshold |
| --- | --- | --- | --- |
| 1 | `non_empty_array` | output must be a non-empty JSON array | absolute fail if not array or length 0 |
| 2 | `required_fields_present` | `job_title`, `location`, `application_url` must be non-empty strings on each record | fail if >10% of records are missing/blank on any of the three (up to 3 example records returned) |
| 3 | `row_count_sanity` | `recordCount >= baselineCount * 0.5` | absolute fail if below half the baseline's count |
| 4 | `url_shape` | `application_url` values must start with `"http"` | fail if >10% of records violate |
| 5 | `no_mass_duplication` | not >50% of records share an identical `job_title` | fail if a single title cluster exceeds 50% |

**Natural-drift tolerance:** none of the rules require an exact match to the baseline. Roles can be added or removed over the week; the validator only rejects outputs that fall outside sane bounds. Specifically:

- `row_count_sanity` allows up to 50% roles to disappear before flagging.
- `required_fields_present` and `url_shape` tolerate up to 10% broken records.
- `no_mass_duplication` tolerates up to 50% duplication (a real board may legitimately list the same title across two teams).

## Field names

Phase 3 aligned the schema with the **real scraper output field names** (recorded in `config/schema.json`'s `fields` array): `job_title`, `location`, `application_url` — plus optional `location_type` and `product_page_url`. The original v1 guesses (`role_title`, `job_url`) were abandoned as a Phase 2 closing-out step. `planned_v2_fields` (`department`, `employment_type`, `date_posted`) remain reserved and untouched — a separate top-level category for a later self-heal schema-extension demo.

## Test fixtures (`test-fixtures/`)

| fixture | expected | expected failing rule(s) |
| --- | --- | --- |
| `passing-real-baseline.json` | pass | (none) - exact byte copy of `scraper/baseline-output.json` |
| `failing-empty-array.json` | fail | `non_empty_array` only |
| `failing-high-nulls.json` | fail | `required_fields_present` only - real baseline with `job_title` set to `null` on 4 of 31 records (12.9% > 10%) |

`run-tests.ts` asserts both the pass/fail outcome AND the exact set of failing rule name(s) per fixture — it will catch regressions if a rule is later added, removed, or re-tuned.

## Usage

```bash
npm run validate                       # compare scraper/runs/latest.json to baseline
npm run validate -- scraper/runs/2026-08-20T21-54-36-908Z.json   # override the run path
npm run validate:test                  # run all fixture assertions
```

## What this directory is NOT

- Not a JSON-schema validator (there's no `ajv` or similar dep). It's a focused rule-based check tuned to layout-break signatures, not a general-purpose contract checker.
- Not the healing orchestrator. Phase 4 lives in `orchestrator/`. It will import `validate()` and read its `diff` array to decide whether and how to call `bdata scraper heal`.
