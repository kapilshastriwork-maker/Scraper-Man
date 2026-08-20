import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { validate } from "../validator/validate.js";
import { initDb, syncJobs, type SyncSummary } from "./db.js";

const REPO_ROOT = process.cwd();
const BASELINE_PATH = resolve(REPO_ROOT, "scraper", "baseline-output.json");
const DEFAULT_RUN_PATH = resolve(REPO_ROOT, "scraper", "runs", "latest.json");
const DEFAULT_DB_PATH = resolve(REPO_ROOT, "downstream", "data.db");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(): void {
  const runPath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_RUN_PATH;

  if (!existsSync(runPath)) {
    console.error(`Run file not found: ${runPath}`);
    process.exit(1);
  }

  const baseline = loadJson(BASELINE_PATH);
  const runOutput = loadJson(runPath);

  // Gate: only validated data reaches storage. Same convention as `npm run validate`.
  const result = validate(runOutput, baseline, "full");

  if (!result.pass) {
    console.error(`FAIL (${result.recordCount} records vs baseline ${result.baselineCount}) — not syncing to downstream DB.`);
    console.error("");
    for (const entry of result.diff) {
      console.error(`  [${entry.rule}] ${entry.message}`);
      if (entry.examples && entry.examples.length > 0) {
        console.error("  examples:");
        for (const ex of entry.examples) {
          console.error(`    - ${JSON.stringify(ex)}`);
        }
      }
      console.error("");
    }
    console.error("DB left untouched. Re-run after a successful scrape or a heal.");
    process.exit(1);
  }

  if (!Array.isArray(runOutput)) {
    console.error(`Internal error: validation passed but run output is not an array (got ${typeof runOutput}). Refusing to sync.`);
    process.exit(1);
  }

  const runTimestamp = new Date().toISOString();
  initDb(DEFAULT_DB_PATH);
  const summary: SyncSummary = syncJobs(DEFAULT_DB_PATH, runOutput, runTimestamp);

  console.log(`SYNC OK (${result.recordCount} records) -> ${DEFAULT_DB_PATH}`);
  console.log(`  added:    ${summary.added}`);
  console.log(`  updated:  ${summary.updated}`);
  console.log(`  closedOut: ${summary.closedOut}`);
  process.exit(0);
}

main();
