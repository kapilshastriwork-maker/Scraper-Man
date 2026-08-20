import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = process.cwd();
const BDATA = "npx -p @brightdata/cli bdata";

interface ScraperConfig {
  collectorId: string;
  targetUrl: string;
  createdAt: string;
  fields: string[];
  fieldDescription: string;
  abandonedCollectorIds?: string[];
}

function loadConfig(): ScraperConfig {
  const raw = readFileSync(resolve(REPO_ROOT, "config", "scraper.json"), "utf8");
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
  const runsDir = resolve(REPO_ROOT, "scraper", "runs");
  mkdirSync(runsDir, { recursive: true });
  const ts = isoTimestampForFilename(startedAt);
  const stampedPath = resolve(runsDir, `${ts}.json`);
  const latestPath = resolve(runsDir, "latest.json");
  const utf8NoBom = Buffer.from(trimmed, "utf8");
  writeFileSync(stampedPath, utf8NoBom);
  writeFileSync(latestPath, utf8NoBom);
  let recordCount = -1;
  try {
    const parsed = JSON.parse(trimmed) as unknown[];
    recordCount = Array.isArray(parsed) ? parsed.length : -1;
  } catch {
    recordCount = -1;
  }
  console.log(
    `\nRun complete.\n  started: ${startedAt.toISOString()}\n  records: ${recordCount}\n  full output -> scraper/runs/${ts}.json\n  mirror      -> scraper/runs/latest.json\n  baseline (frozen, untouched) -> scraper/baseline-output.json`,
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
