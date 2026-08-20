import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validate } from "./validate";

const REPO_ROOT = process.cwd();
const BASELINE_PATH = resolve(REPO_ROOT, "scraper", "baseline-output.json");
const DEFAULT_RUN_PATH = resolve(REPO_ROOT, "scraper", "runs", "latest.json");

function loadJson(path: string): unknown {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function main(): void {
  const runPath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_RUN_PATH;

  const baseline = loadJson(BASELINE_PATH);
  const runOutput = loadJson(runPath);

  const result = validate(runOutput, baseline);

  if (result.pass) {
    console.log(`PASS (${result.recordCount} records)`);
    process.exit(0);
  }

  console.error(`FAIL (${result.recordCount} records vs baseline ${result.baselineCount})`);
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
  process.exit(1);
}

main();
