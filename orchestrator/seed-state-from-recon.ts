import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface HealResult {
  status?: string;
  preview_result?: unknown[];
  prompt?: string;
}

interface State {
  lastKnownStatus: string;
  lastHealPreviewResult: unknown[] | null;
  lastHealPrompt: string | null;
  pendingHealTimestamp: string | null;
  updatedAt: string;
}

function usage(): void {
  console.error(
    "Usage: npm run state:seed -- <reconFile> <stateFile> [--force]\n" +
    "  Parses a captured `bdata scraper heal` raw output file for an awaiting_approval\n" +
    "  heal and seeds orchestrator/state.json from it, without re-triggering the heal.\n" +
    "  Refuses to overwrite an existing <stateFile> unless --force is passed.",
  );
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 2) usage();
  const force = args.includes("--force");
  const positional = args.filter((a) => a !== "--force");
  if (positional.length < 2) usage();
  const [reconFile, stateFile] = positional;

  const reconPath = resolve(process.cwd(), reconFile);
  const statePath = resolve(process.cwd(), stateFile);

  if (!existsSync(reconPath)) {
    console.error(`Recon file not found: ${reconPath}`);
    process.exit(1);
  }

  if (existsSync(statePath) && !force) {
    console.error(
      `state.json already exists at ${statePath} — pass --force to overwrite. No changes made.`,
    );
    process.exit(1);
  }

  const raw = readFileSync(reconPath, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  let jsonLine: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("{")) {
      jsonLine = lines[i];
      break;
    }
  }
  if (!jsonLine) {
    console.error(`No JSON payload (line starting with "{") found in recon file: ${reconPath}`);
    process.exit(1);
  }

  let parsed: HealResult;
  try {
    parsed = JSON.parse(jsonLine) as HealResult;
  } catch (err) {
    console.error(`Failed to parse JSON payload from recon file: ${String(err)}`);
    process.exit(1);
  }

  if (parsed.status !== "awaiting_approval" && parsed.status !== "done") {
    console.error(
      `Recon file's heal status is "${parsed.status ?? "(missing)"}", must be "awaiting_approval" or "done". Nothing to seed.`,
    );
    process.exit(1);
  }

  let state: State;
  if (parsed.status === "awaiting_approval") {
    state = {
      lastKnownStatus: "awaiting_approval",
      lastHealPreviewResult: Array.isArray(parsed.preview_result) ? parsed.preview_result : null,
      lastHealPrompt: parsed.prompt ?? null,
      pendingHealTimestamp: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } else {
    // status === "done": seed a clean post-approve state. Used to correct state.json
    // after an approve that completed outside the normal orchestrate() flow (or to
    // repair a state/collector disagreement — see PROGRESS.md Phase 4 session log).
    state = {
      lastKnownStatus: "done",
      lastHealPreviewResult: null,
      lastHealPrompt: null,
      pendingHealTimestamp: null,
      updatedAt: new Date().toISOString(),
    };
  }

  writeFileSync(statePath, Buffer.from(JSON.stringify(state, null, 2), "utf8"));
  console.log(`Seeded ${statePath} from ${reconPath}.`);
  console.log(`  lastKnownStatus:        ${state.lastKnownStatus}`);
  console.log(`  lastHealPreviewResult:  ${state.lastHealPreviewResult ? `${state.lastHealPreviewResult.length} record(s)` : "(none)"}`);
  console.log(`  lastHealPrompt:         ${state.lastHealPrompt ? state.lastHealPrompt.slice(0, 80) + "..." : "(none)"}`);
  if (force && existsSync(statePath)) {
    console.log("  (overwrote existing state.json — --force was passed)");
  }
}

main();
