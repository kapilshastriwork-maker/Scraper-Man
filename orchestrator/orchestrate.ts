import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validate, type ValidationResult } from "../validator/validate.js";
import { composeHealPrompt } from "./compose-heal-prompt.js";
import { syncJobs, type SyncSummary } from "../downstream/db.js";

const REPO_ROOT = process.cwd();
const BDATA = "npx -p @brightdata/cli bdata";

// ---------- Types ----------

interface ScraperConfig {
  collectorId: string;
  targetUrl: string;
  [k: string]: unknown;
}

export interface HealResult {
  collector_id?: string;
  status?: string;
  completed_steps?: string[];
  prompt?: string;
  view_url?: string;
  next_step?: string;
  preview_result?: unknown[];
  diff_summary?: string;
}

export interface Services {
  runScraper(): Promise<unknown>;
  healScraper(prompt: string): Promise<HealResult>;
  approveScraper(): Promise<void>;
  // Called automatically on any full-validate PASS — never on escalation branches
  // (unvalidated data never reaches downstream storage). Returns the upsert/closeout
  // counts so the audit entry can record exactly what changed in storage.
  syncToDownstream(records: unknown[], runTimestamp: string): Promise<SyncSummary>;
}

export type OrchestrateTrigger =
  | "healthy_run_no_action"
  | "healed_and_approved"
  | "healed_and_escalated"
  | "found_existing_pending_heal";

export interface AuditEntry {
  timestamp: string;
  trigger: OrchestrateTrigger;
  validationResultSummary: string;
  healPromptSent: string | null;
  collectorStateBefore: string;
  collectorStateAfter: string;
  previewResultSummary: unknown[];
  decision: string;
  reasoning: string;
  // null when sync wasn't applicable (escalation branches — unvalidated data);
  // populated with the upsert/closeout summary on the two full-validate PASS paths:
  // branch (c) healthy_run_no_action + branch (e) approved.
  syncResult: SyncSummary | null;
}

export interface State {
  lastKnownStatus: string;
  lastHealPreviewResult: unknown[] | null;
  lastHealPrompt: string | null;
  pendingHealTimestamp: string | null;
  updatedAt: string;
}

export interface OrchestrateOutcome {
  trigger: OrchestrateTrigger;
  decision: "no_action" | "approved" | "escalated_preview_failed" | "escalated_final_validate_failed";
  reasoning: string;
  auditEntry: AuditEntry;
}

interface OrchestrateOpts {
  services?: Partial<Services>;
  auditPath?: string;
  statePath?: string;
  baselinePath?: string;
  dbPath?: string;
  // --target=demo|real (default real). Demo branches the config/baseline/state/
  // audit paths to the demo-page artifacts and SKIPS downstream storage entirely
  // (the SQLite jobs DB is the real target's downstream product; the demo
  // target's purpose is only to exercise validate/heal/approve end-to-end).
  target?: "real" | "demo";
}

// ---------- Config / file helpers ----------

function loadConfig(target: "real" | "demo" = "real"): ScraperConfig {
  const configFile =
    target === "demo" ? resolve(REPO_ROOT, "config", "demo-scraper.json") : resolve(REPO_ROOT, "config", "scraper.json");
  return JSON.parse(readFileSync(configFile, "utf8")) as ScraperConfig;
}

function loadBaseline(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readState(statePath: string): State | null {
  if (existsSync(statePath)) {
    try {
      return JSON.parse(readFileSync(statePath, "utf8")) as State;
    } catch {
      return null;
    }
  }
  // No state.json found at statePath → treat as clean/empty state (no known
  // pending heal), which routes to branch (c). Explicit seeding is the
  // responsibility of orchestrator/seed-state-from-recon.ts (`npm run state:seed`).
  return null;
}

function writeState(statePath: string, state: State): void {
  state.updatedAt = new Date().toISOString();
  writeFileSync(statePath, Buffer.from(JSON.stringify(state, null, 2), "utf8"));
}

function appendAuditEntry(auditPath: string, entry: AuditEntry): void {
  appendFileSync(auditPath, Buffer.from(JSON.stringify(entry) + "\n", "utf8"));
}

function summarizeValidation(result: ValidationResult): string {
  const rules = result.diff.map((d) => d.rule).join(", ") || "(none)";
  return `pass: ${result.pass}, ${result.recordCount} records vs baseline ${result.baselineCount}, rules fired: [${rules}]`;
}

function summarizePreview(preview: unknown): unknown[] {
  return Array.isArray(preview) ? preview.slice(0, 2) : [];
}

// ---------- Real services (production) ----------
//
// buildRealServices returns only the three bdata-touching service methods;
// `syncToDownstream` (DB-concern, not bdata-concern) is assembled inside
// orchestrate() itself so it can close over the per-call `dbPath` opt.

type BdataServices = Pick<Services, "runScraper" | "healScraper" | "approveScraper">;

function buildRealServices(cfg: ScraperConfig, target: "real" | "demo" = "real"): BdataServices {
  const npmRunScript =
    target === "demo" ? "npm run scraper:run -- --target=demo" : "npm run scraper:run";
  const runsLatestPath =
    target === "demo"
      ? resolve(REPO_ROOT, "demo-page", "demo-runs", "latest.json")
      : resolve(REPO_ROOT, "scraper", "runs", "latest.json");
  return {
    async runScraper(): Promise<unknown> {
      // Invoke `npm run scraper:run` so timestamped + latest.json artifacts are
      // written exactly as a manual run would (per Phase 2 guidance). The demo
      // target's run-cli path also normalizes the raw wrapped platform output
      // before writing (see demo-page/normalize-demo-output.ts), so the shape
      // read back from latest.json is already flat.
      execSync(npmRunScript, { stdio: "inherit", cwd: REPO_ROOT });
      return JSON.parse(readFileSync(runsLatestPath, "utf8"));
    },
    async healScraper(prompt: string): Promise<HealResult> {
      const escaped = prompt.replace(/"/g, '\\"');
      const stdout = execSync(`${BDATA} scraper heal ${cfg.collectorId} "${escaped}"`, {
        stdio: ["ignore", "pipe", "inherit"],
        maxBuffer: 64 * 1024 * 1024,
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      const lines = stdout.trim().split(/\r?\n/);
      return JSON.parse(lines[lines.length - 1]) as HealResult;
    },
    async approveScraper(): Promise<void> {
      execSync(`${BDATA} scraper approve ${cfg.collectorId}`, { stdio: "inherit", cwd: REPO_ROOT });
    },
  };
}

// ---------- The orchestrate flow ----------

export async function orchestrate(opts: OrchestrateOpts = {}): Promise<OrchestrateOutcome> {
  const target = opts.target ?? "real";
  const auditPath =
    opts.auditPath ?? resolve(REPO_ROOT, "orchestrator", target === "demo" ? "audit-log-demo.jsonl" : "audit-log.jsonl");
  const statePath =
    opts.statePath ?? resolve(REPO_ROOT, "orchestrator", target === "demo" ? "state-demo.json" : "state.json");
  const baselinePath =
    opts.baselinePath ??
    resolve(REPO_ROOT, target === "demo" ? "demo-page/demo-baseline-output.json" : "scraper/baseline-output.json");
  const dbPath = opts.dbPath ?? resolve(REPO_ROOT, "downstream", "data.db");

  const cfg = loadConfig(target);
  const real = buildRealServices(cfg, target);
  const services: Services = {
    runScraper: opts.services?.runScraper ?? real.runScraper,
    healScraper: opts.services?.healScraper ?? real.healScraper,
    approveScraper: opts.services?.approveScraper ?? real.approveScraper,
    syncToDownstream:
      opts.services?.syncToDownstream ??
      (target === "demo"
        ? // DEMO TARGET: downstream sync is SKIPPED ENTIRELY. The SQLite jobs DB
          // (first_seen_at/is_active history + jobs.html) is the real target's
          // downstream product; demo runs must never write to it. This stub
          // throws so an accidental call site regression fails loudly instead
          // of silently polluting the real database.
          async (): Promise<SyncSummary> => {
            throw new Error("syncToDownstream called on the demo target - storage is disabled for demo runs.");
          }
        : (async (records: unknown[], runTimestamp: string) => syncJobs(dbPath, records, runTimestamp))),
  };
  // Guard used at both full-validate-PASS call sites below: on the demo target,
  // syncResult stays null (audit shape already tolerates that) and the DB is
  // never touched.
  const skipDownstreamSync = target === "demo";

  const baseline = loadBaseline(baselinePath);
  const stateBefore = readState(statePath);
  const collectorStateBefore = stateBefore?.lastKnownStatus ?? "unknown";

  // --- (a) & (b) Check current collector state ---
  // Branch (b) exists specifically to skip branch (c)'s fresh run when a pending
  // heal is already found. Run-file count under `scraper/runs/` varies by which
  // branch fired: branch (b)->(e) produces ONE new run file (the post-approve
  // confirmation), while branch (c)->(e) produces TWO (the initial break-detecting
  // run + the post-approve confirmation). Step 9's real run exercises branch
  // (b)->(d)->(e), so exactly ONE new run file is expected.
  const pendingPreview =
    stateBefore?.lastKnownStatus === "awaiting_approval" &&
    Array.isArray(stateBefore.lastHealPreviewResult) &&
    stateBefore.lastHealPreviewResult.length > 0
      ? (stateBefore.lastHealPreviewResult as unknown[])
      : null;

  if (pendingPreview !== null) {
    // Branch (b): reuse already-pending heal's preview_result, jump to (d).
    return await previewDecisionPhase({
      pendingPreview,
      auditPath,
      statePath,
      baseline,
      services,
      collectorStateBefore,
      collectorStateAfter: collectorStateBefore,
      healPromptSent: stateBefore?.lastHealPrompt ?? null,
      trigger: "found_existing_pending_heal",
      previewResultSummary: summarizePreview(pendingPreview),
      skipDownstreamSync,
    });
  }

  // --- (c) Branch: run scraper, full-validate ---
  const runOutput = await services.runScraper();
  const fullResult = validate(runOutput, baseline, "full");

  if (fullResult.pass) {
    // Full-validate PASS → sync to downstream storage. The validate() contract
    // guarantees runOutput is a non-empty array here (the non_empty_array rule
    // would have failed otherwise), so the cast is safe. Cast is the cleanest
    // way to satisfy syncToDownstream's `unknown[]` signature without making
    // validate()'s return type parameterised on the input shape.
    // Demo target: sync is deliberately skipped (see skipDownstreamSync above);
    // syncResult stays null and no DB file is ever opened.
    const records = (Array.isArray(runOutput) ? runOutput : []) as unknown[];
    const syncResult = skipDownstreamSync
      ? null
      : await services.syncToDownstream(records, new Date().toISOString());
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      trigger: "healthy_run_no_action",
      validationResultSummary: summarizeValidation(fullResult),
      healPromptSent: null,
      collectorStateBefore,
      collectorStateAfter: collectorStateBefore,
      previewResultSummary: [],
      decision: "no_action",
      reasoning: skipDownstreamSync
        ? "Run validated cleanly against baseline. No heal needed. Downstream storage skipped (demo target)."
        : "Run validated cleanly against baseline. No heal needed. Synced to downstream storage.",
      syncResult,
    };
    appendAuditEntry(auditPath, entry);
    return { trigger: "healthy_run_no_action", decision: "no_action", reasoning: entry.reasoning, auditEntry: entry };
  }

  // Fail → compose heal prompt, trigger real heal, persist state, fall through to (d).
  const prompt = composeHealPrompt(fullResult);
  const healResult = await services.healScraper(prompt);
  const preview = Array.isArray(healResult.preview_result) ? (healResult.preview_result as unknown[]) : [];
  const collectorStateAfter = healResult.status ?? "awaiting_approval";

  const newState: State = {
    lastKnownStatus: collectorStateAfter,
    lastHealPreviewResult: preview,
    lastHealPrompt: prompt,
    pendingHealTimestamp: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeState(statePath, newState);

  return await previewDecisionPhase({
    pendingPreview: preview,
    auditPath,
    statePath,
    baseline,
    services,
    collectorStateBefore,
    collectorStateAfter,
    healPromptSent: prompt,
    trigger: "healed_and_approved",
    previewResultSummary: summarizePreview(preview),
    skipDownstreamSync,
  });
}

// ---------- Preview decision phase (shared by branch b and branch c) ----------

interface PreviewPhaseArgs {
  pendingPreview: unknown[];
  auditPath: string;
  statePath: string;
  baseline: unknown;
  services: Services;
  collectorStateBefore: string;
  collectorStateAfter: string;
  healPromptSent: string | null;
  trigger: OrchestrateTrigger;
  previewResultSummary: unknown[];
  // demo target: downstream storage is disabled entirely; syncResult stays null.
  skipDownstreamSync: boolean;
}

async function previewDecisionPhase(args: PreviewPhaseArgs): Promise<OrchestrateOutcome> {
  const previewResult = validate(args.pendingPreview, args.baseline, "preview");

  if (previewResult.pass) {
    // --- (e) Preview passed → approve + re-run + final full-validate ---
    await args.services.approveScraper();
    const freshOutput = await args.services.runScraper();
    const finalResult = validate(freshOutput, args.baseline, "full");

    let decision: OrchestrateOutcome["decision"];
    let reasoning: string;
    let collectorStateAfter = "done";
    // syncResult: only populated when finalResult.pass === true. On
    // escalated_final_validate_failed the post-approve scrape did NOT validate,
    // so the (unvalidated) data must not reach downstream storage — syncResult
    // stays null and the audit entry records that sync was deliberately skipped.
    let syncResult: SyncSummary | null = null;

    if (finalResult.pass) {
      decision = "approved";
      reasoning = args.skipDownstreamSync
        ? "Preview passed and post-approve fresh scrape validated cleanly. Heal confirmed. Downstream storage skipped (demo target)."
        : "Preview passed and post-approve fresh scrape validated cleanly. Heal confirmed. Synced to downstream storage.";
      // Demo target: sync deliberately skipped - unvalidated-or-demo data must
      // never reach the real SQLite store (see orchestrate() comment).
      const records = (Array.isArray(freshOutput) ? freshOutput : []) as unknown[];
      syncResult = args.skipDownstreamSync
        ? null
        : await args.services.syncToDownstream(records, new Date().toISOString());
    } else {
      decision = "escalated_final_validate_failed";
      reasoning = `Preview passed and approve succeeded, but the post-approve fresh scrape FAILED full-validation: ${summarizeValidation(finalResult)}. Left as-is for human inspection (no auto-retry). Unvalidated data NOT synced to storage.`;
    }

    // Persist the post-approve state: the approve call genuinely completed (the
    // collector's actual status is "done" whether or not the post-approve scrape
    // validated). Clearing the cached pending preview/prompt prevents the next
    // orchestrate() run from mis-routing to branch (b) for an approval that's
    // already been consumed. Without this, state.json would disagree with the
    // real collector state (caught during Phase 4 step 9 — see PROGRESS.md).
    writeState(args.statePath, {
      lastKnownStatus: "done",
      lastHealPreviewResult: null,
      lastHealPrompt: null,
      pendingHealTimestamp: null,
      updatedAt: new Date().toISOString(),
    });

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      trigger: args.trigger,
      validationResultSummary: summarizeValidation(finalResult),
      healPromptSent: args.healPromptSent,
      collectorStateBefore: args.collectorStateBefore,
      collectorStateAfter,
      previewResultSummary: args.previewResultSummary,
      decision,
      reasoning,
      syncResult,
    };
    appendAuditEntry(args.auditPath, entry);
    return { trigger: args.trigger, decision, reasoning, auditEntry: entry };
  }

  // --- (f) Preview failed → leave awaiting_approval, escalate ---
  // Intentionally NO writeState call here: the collector really is still in
  // awaiting_approval on Bright Data (we didn't approve), so the cached preview
  // and prompt in state.json are still accurate and should remain for a future
  // orchestrate() run or human inspection.
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    trigger: args.trigger === "found_existing_pending_heal" ? args.trigger : "healed_and_escalated",
    validationResultSummary: summarizeValidation(previewResult),
    healPromptSent: args.healPromptSent,
    collectorStateBefore: args.collectorStateBefore,
    collectorStateAfter: "awaiting_approval",
    previewResultSummary: args.previewResultSummary,
    decision: "escalated_preview_failed",
    reasoning: `Preview validation FAILED: ${summarizeValidation(previewResult)}. Intentionally NOT approved or rejected - collector left in awaiting_approval for human inspection in the dashboard. Unvalidated data NOT synced to storage.`,
    syncResult: null,
  };
  appendAuditEntry(args.auditPath, entry);
  return { trigger: entry.trigger, decision: "escalated_preview_failed", reasoning: entry.reasoning, auditEntry: entry };
}

// ---------- Production entrypoint ----------
// Gate `main()` behind "is this file being run directly (not imported by a test)".
// Without this, importing orchestrate() in run-tests.ts would also fire the real
// production main() and call process.exit, killing the test process.
async function main(): Promise<void> {
  // --target=demo|real via CLI flag or ORCHESTRATE_TARGET env; default real.
  const targetFlag = process.argv.find((a) => a.startsWith("--target="));
  const target =
    targetFlag !== undefined
      ? targetFlag.split("=")[1] === "demo"
        ? ("demo" as const)
        : ("real" as const)
      : process.env.ORCHESTRATE_TARGET === "demo"
        ? ("demo" as const)
        : ("real" as const);
  console.log(`[orchestrate] starting at ${new Date().toISOString()} (target: ${target})`);
  const outcome = await orchestrate({ target });
  console.log("");
  console.log(`[orchestrate] trigger:   ${outcome.trigger}`);
  console.log(`[orchestrate] decision:   ${outcome.decision}`);
  console.log(`[orchestrate] reasoning: ${outcome.reasoning}`);
  if (outcome.decision.startsWith("escalated")) {
    console.log("");
    console.error("[orchestrate] ESCALATION - human inspection required (see audit log).");
    process.exit(2);
  }
  process.exit(0);
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) void main();
