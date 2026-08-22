import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeDemoOutput } from "../demo-page/normalize-demo-output.js";

const REPO_ROOT = process.cwd();
const BDATA = "npx -p @brightdata/cli bdata";

// --target=demo|real (default real). Demo switches config file, run-output
// directory, and (demo only) normalizes raw platform output before writing.
type Target = "real" | "demo";

function parseTarget(): Target {
  const flag = process.argv.find((a) => a.startsWith("--target="));
  if (flag === undefined) return "real";
  const value = flag.split("=")[1];
  if (value !== "real" && value !== "demo") {
    console.error(`Invalid --target value: ${value} (expected "real" or "demo")`);
    process.exit(1);
  }
  return value;
}

const TARGET: Target = parseTarget();

interface ScraperConfig {
  collectorId: string;
  targetUrl: string;
  createdAt: string;
  fields: string[];
  fieldDescription: string;
  abandonedCollectorIds?: string[];
}

function loadConfig(): ScraperConfig {
  const configFile = TARGET === "demo" ? "config/demo-scraper.json" : "config/scraper.json";
  const raw = readFileSync(resolve(REPO_ROOT, configFile), "utf8");
  return JSON.parse(raw) as ScraperConfig;
}

function isoTimestampForFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

const subcommand = process.argv[2];
const extraArgs = process.argv.slice(3);

function create(): void {
  const cfg = loadConfig();
  const cmd = `${BDATA} scraper create ${cfg.targetUrl} "${cfg.fieldDescription}"`;
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: "inherit", cwd: REPO_ROOT });
  console.log(
    "\nScraper template created in Scraper Studio. If you got a new collector_id back, update config/scraper.json before running `npm run scraper:run`.",
  );
}

function run(): void {
  const cfg = loadConfig();
  const startedAt = new Date();
  const cmd = `${BDATA} scraper run ${cfg.collectorId} ${cfg.targetUrl}`;
  console.log(`\n> ${cmd}\n`);
  let stdout = "";
  try {
    stdout = execSync(cmd, {
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 64 * 1024 * 1024,
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
  } catch (err) {
    console.error("\nbdata scraper run failed:", err);
    process.exit(1);
  }
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("[")) {
    console.error("\nUnexpected non-JSON stdout from bdata scraper run:\n", trimmed);
    process.exit(2);
  }
  let payload = trimmed;
  if (TARGET === "demo") {
    // Demo target ONLY: the platform's production template wraps records under
    // job_listings with space-keyed names regardless of create/heal prompts
    // (see demo-page/normalize-demo-output.ts header for the full evidence).
    // Reshape here so validation never sees the wrapped shape. Pure reshape of
    // already-extracted values - no extraction logic lives in this repo.
    const parsedRaw: unknown = JSON.parse(trimmed);
    payload = JSON.stringify(normalizeDemoOutput(parsedRaw), null, 2);
  }
  const runsDir =
    TARGET === "demo"
      ? resolve(REPO_ROOT, "demo-page", "demo-runs")
      : resolve(REPO_ROOT, "scraper", "runs");
  mkdirSync(runsDir, { recursive: true });
  const ts = isoTimestampForFilename(startedAt);
  const stampedPath = resolve(runsDir, `${ts}.json`);
  const latestPath = resolve(runsDir, "latest.json");
  const utf8NoBom = Buffer.from(payload, "utf8");
  writeFileSync(stampedPath, utf8NoBom);
  writeFileSync(latestPath, utf8NoBom);
  let recordCount = -1;
  try {
    const parsed = JSON.parse(payload) as unknown[];
    recordCount = Array.isArray(parsed) ? parsed.length : -1;
  } catch {
    recordCount = -1;
  }
  const runsDirLabel = TARGET === "demo" ? "demo-page/demo-runs" : "scraper/runs";
  console.log(
    `\nRun complete (target: ${TARGET}).\n  started: ${startedAt.toISOString()}\n  records: ${recordCount}\n  full output -> ${runsDirLabel}/${ts}.json\n  mirror      -> ${runsDirLabel}/latest.json\n  baseline (frozen, untouched) -> ${TARGET === "demo" ? "demo-page/demo-baseline-output.json" : "scraper/baseline-output.json"}`,
  );
}

function heal(): void {
  const cfg = loadConfig();
  const reason = extraArgs.length > 0 ? extraArgs.join(" ") : "";
  if (!reason) {
    console.error(
      'Usage: npm run scraper:heal -- "<reason>"\nExample: npm run scraper:heal -- "empty jobs array, expected role_title/location/job_url"',
    );
    process.exit(1);
  }
  const cmd = `${BDATA} scraper heal ${cfg.collectorId} "${reason.replace(/"/g, '\\"')}"`;
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: "inherit", cwd: REPO_ROOT });
}

function approve(): void {
  const cfg = loadConfig();
  const cmd = `${BDATA} scraper approve ${cfg.collectorId}`;
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: "inherit", cwd: REPO_ROOT });
}

switch (subcommand) {
  case "create":
    create();
    break;
  case "run":
    run();
    break;
  case "heal":
    heal();
    break;
  case "approve":
    approve();
    break;
  default:
    console.error(
      `Unknown subcommand: ${subcommand ?? "(none)"}\nUsage: npm run scraper:<create|run|heal|approve> [-- args]`,
    );
    process.exit(1);
}
