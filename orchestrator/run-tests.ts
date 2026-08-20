import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate, type ValidationResult } from "../validator/validate.js";
import { composeHealPrompt } from "./compose-heal-prompt.js";
import { orchestrate, type Services, type HealResult } from "./orchestrate.js";

// ---------- Helpers ----------

function makeBaseline(): unknown {
  const records: unknown[] = [];
  for (let i = 0; i < 31; i++) {
    records.push({
      job_title: `Role ${i}`,
      location: "San Francisco Bay Area",
      application_url: `https://jobs.ashbyhq.com/retell-ai/job-${i}/application`,
      location_type: "On-site",
      product_page_url: `https://jobs.ashbyhq.com/retell-ai/job-${i}`,
    });
  }
  return records;
}

function writeBaseline(tmpRoot: string, baseline: unknown): string {
  const baselinePath = join(tmpRoot, "baseline-output.json");
  writeFileSync(baselinePath, Buffer.from(JSON.stringify(baseline), "utf8"));
  return baselinePath;
}

function makeFailingValidationResult(): ValidationResult {
  return {
    pass: false,
    recordCount: 0,
    baselineCount: 31,
    diff: [
      { rule: "non_empty_array", severity: "fail", message: "Output is not a non-empty array - this is the textbook layout-break signature (the scraper returned nothing scrapeable)." },
      {
        rule: "required_fields_present",
        severity: "fail",
        message: "31 of 31 records (100.0%) are missing or have a blank value for a required field.",
        examples: [{ job_title: null, location: "x", application_url: "x" }],
      },
    ],
  };
}

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

// ---------- Tests (async) ----------

async function testComposeHealPrompt(): Promise<TestResult> {
  const result = makeFailingValidationResult();
  const prompt = composeHealPrompt(result);
  const hasNonEmpty = prompt.includes("empty array");
  const hasRequired = prompt.includes("missing or have a blank value");
  const hasExample = prompt.includes("record 1") || prompt.includes("job_title");
  const notJson = !prompt.trim().startsWith("[") && !prompt.trim().startsWith("{");
  const pass = prompt.length > 0 && hasNonEmpty && hasRequired && hasExample && notJson;
  return {
    name: "composeHealPrompt: produces plain-language paragraph from a known diff",
    pass,
    detail: pass
      ? `prompt length=${prompt.length}, contains both rule phrases, includes example, not JSON.`
      : `prompt: ${prompt.slice(0, 200)}...`,
  };
}

async function testPreviewModeSkipsPopulationRules(): Promise<TestResult> {
  const baseline = makeBaseline();
  const sample: unknown[] = [
    {
      job_title: "Senior Engineer",
      location: "San Francisco Bay Area",
      application_url: "https://jobs.ashbyhq.com/retell-ai/preview-1/application",
    },
  ];
  const full = validate(sample, baseline, "full");
  const preview = validate(sample, baseline, "preview");
  const fullFires =
    !full.pass &&
    full.diff.map((d) => d.rule).includes("no_mass_duplication") &&
    full.diff.map((d) => d.rule).includes("row_count_sanity");
  const previewClean = preview.pass && preview.diff.length === 0;
  const pass = fullFires && previewClean;
  return {
    name: "validate(preview): skips row_count_sanity + no_mass_duplication",
    pass,
    detail: pass
      ? `full mode fired [${full.diff.map((d) => d.rule).join(", ")}]; preview mode passed cleanly.`
      : `full fired [${full.diff.map((d) => d.rule).join(", ")}]; preview fired [${preview.diff.map((d) => d.rule).join(", ")}]`,
  };
}

async function testDecisionApprovesOnPassingPreview(): Promise<TestResult> {
  const baseline = makeBaseline();
  const previewRecord = {
    job_title: "Senior Engineer",
    location: "San Francisco Bay Area",
    application_url: "https://jobs.ashbyhq.com/retell-ai/preview-1/application",
  };
  const healResult: HealResult = {
    status: "awaiting_approval",
    preview_result: [previewRecord],
    prompt: "test prompt",
  };
  const tmp = mkdtempSync(join(tmpdir(), "orch-test-"));
  const baselinePath = writeBaseline(tmp, baseline);
  const auditPath = join(tmp, "audit-log.jsonl");
  const statePath = join(tmp, "state.json");

  const calls: string[] = [];
  const services: Services = {
    runScraper: async () => {
      calls.push("runScraper");
      // First call (branch c initial run) returns a BROKEN output so we reach the
      // heal path; second call (post-approve confirm) returns a HEALTHY output.
      if (calls.filter((c) => c === "runScraper").length === 1) {
        return [];
      }
      return baseline;
    },
    healScraper: async (prompt: string) => {
      calls.push("healScraper:" + prompt.slice(0, 30));
      return healResult;
    },
    approveScraper: async () => {
      calls.push("approveScraper");
    },
    syncToDownstream: async (records: unknown[], _runTimestamp: string) => {
      calls.push(`syncToDownstream:${records.length}`);
      return { added: records.length, updated: 0, closedOut: 0 };
    },
  };

  const outcome = await orchestrate({ services, auditPath, statePath, baselinePath });
  const approved = calls.includes("approveScraper");
  const runCalls = calls.filter((c) => c === "runScraper").length;
  const healCalls = calls.filter((c) => c.startsWith("healScraper")).length;
  const syncCalls = calls.filter((c) => c.startsWith("syncToDownstream")).length;
  const auditExists = existsSync(auditPath);
  const decisionMatches = outcome.decision === "approved" && outcome.trigger === "healed_and_approved";
  // Phase 5 invariant: branch (e) approved path calls syncToDownstream with the
  // post-approve validated records, and the audit entry's syncResult is a non-null
  // summary reflecting those records (not null — that would mean it routed to an
  // escalation branch by mistake).
  const syncWiredCorrectly = syncCalls === 1 && outcome.auditEntry.syncResult !== null
    && (outcome.auditEntry.syncResult as { added: number }).added > 0;
  const pass = approved && runCalls === 2 && healCalls === 1 && syncWiredCorrectly && decisionMatches && auditExists;
  return {
    name: "decision logic (passing preview): approves + re-runs + writes audit entry",
    pass,
    detail: pass
      ? `approved=${approved}, runScraper=${runCalls}, healScraper=${healCalls}, syncToDownstream=${syncCalls}, trigger=${outcome.trigger}, decision=${outcome.decision}, auditExists=${auditExists}, syncResult=${JSON.stringify(outcome.auditEntry.syncResult)}`
      : `approved=${approved}, runScraper=${runCalls}, healScraper=${healCalls}, syncToDownstream=${syncCalls}, trigger=${outcome.trigger}, decision=${outcome.decision}, auditExists=${auditExists}, syncResult=${JSON.stringify(outcome.auditEntry.syncResult)}`,
  };
}

async function testDecisionEscalatesOnFailingPreview(): Promise<TestResult> {
  const baseline = makeBaseline();
  const badPreviewRecord = {
    job_title: null,
    location: "San Francisco Bay Area",
    application_url: "https://jobs.ashbyhq.com/retell-ai/preview-bad/application",
  };
  const healResult: HealResult = {
    status: "awaiting_approval",
    preview_result: [badPreviewRecord],
    prompt: "test prompt",
  };
  const tmp = mkdtempSync(join(tmpdir(), "orch-test-"));
  const baselinePath = writeBaseline(tmp, baseline);
  const auditPath = join(tmp, "audit-log.jsonl");
  const statePath = join(tmp, "state.json");

  const calls: string[] = [];
  const services: Services = {
    runScraper: async () => {
      calls.push("runScraper");
      return [];
    },
    healScraper: async (prompt: string) => {
      calls.push("healScraper:" + prompt.slice(0, 30));
      return healResult;
    },
    approveScraper: async () => {
      calls.push("approveScraper");
    },
    syncToDownstream: async (records: unknown[], _runTimestamp: string) => {
      calls.push(`syncToDownstream:${records.length}`);
      return { added: records.length, updated: 0, closedOut: 0 };
    },
  };

  const outcome = await orchestrate({ services, auditPath, statePath, baselinePath });
  const approved = calls.includes("approveScraper");
  const runCalls = calls.filter((c) => c === "runScraper").length;
  const healCalls = calls.filter((c) => c.startsWith("healScraper")).length;
  const syncCalls = calls.filter((c) => c.startsWith("syncToDownstream")).length;
  const auditExists = existsSync(auditPath);
  const decisionMatches = outcome.decision === "escalated_preview_failed" && outcome.trigger === "healed_and_escalated";
  // Phase 5 invariant: branch (f) escalated_preview_failed does NOT sync to
  // downstream storage (unvalidated data must never reach storage) and the audit
  // entry's syncResult is explicitly null. Both conditions must hold.
  const syncCorrectlySkipped = syncCalls === 0 && outcome.auditEntry.syncResult === null;
  const pass = !approved && runCalls === 1 && healCalls === 1 && syncCorrectlySkipped && decisionMatches && auditExists;
  return {
    name: "decision logic (failing preview): does NOT approve, escalates, writes audit entry",
    pass,
    detail: pass
      ? `approved=${approved}, runScraper=${runCalls}, healScraper=${healCalls}, syncToDownstream=${syncCalls}, trigger=${outcome.trigger}, decision=${outcome.decision}, syncResult=null`
      : `approved=${approved}, runScraper=${runCalls}, healScraper=${healCalls}, syncToDownstream=${syncCalls}, trigger=${outcome.trigger}, decision=${outcome.decision}, syncResult=${JSON.stringify(outcome.auditEntry.syncResult)}`,
  };
}

async function testBranchBReusesPendingPreviewWithoutNewHeal(): Promise<TestResult> {
  // Branch (b): a pre-seeded state.json holds an awaiting_approval heal with a valid
  // 1-record preview_result. orchestrate() should reuse the stored preview WITHOUT
  // calling runScraper (initial run) or healScraper, then approve + re-run + confirm.
  const baseline = makeBaseline();
  const storedPreview = [
    {
      job_title: "Senior Engineer",
      location: "San Francisco Bay Area",
      application_url: "https://jobs.ashbyhq.com/retell-ai/preview-1/application",
    },
  ];
  const seededState = {
    lastKnownStatus: "awaiting_approval",
    lastHealPreviewResult: storedPreview,
    lastHealPrompt: "pre-seeded heal prompt from a prior session",
    pendingHealTimestamp: "2026-08-20T22:10:15.615Z",
    updatedAt: "2026-08-20T22:10:15.615Z",
  };

  const tmp = mkdtempSync(join(tmpdir(), "orch-test-"));
  const baselinePath = writeBaseline(tmp, baseline);
  const auditPath = join(tmp, "audit-log.jsonl");
  const statePath = join(tmp, "state.json");
  writeFileSync(statePath, Buffer.from(JSON.stringify(seededState, null, 2), "utf8"));

  const calls: string[] = [];
  const services: Services = {
    runScraper: async () => {
      calls.push("runScraper");
      // Only the post-approve confirmation run reaches here (branch b skips the
      // initial run). Return a healthy full population.
      return baseline;
    },
    healScraper: async (prompt: string) => {
      calls.push("healScraper:" + prompt.slice(0, 30));
      // Should never be called on branch (b).
      return { status: "awaiting_approval", preview_result: storedPreview, prompt };
    },
    approveScraper: async () => {
      calls.push("approveScraper");
    },
    syncToDownstream: async (records: unknown[], _runTimestamp: string) => {
      calls.push(`syncToDownstream:${records.length}`);
      return { added: records.length, updated: 0, closedOut: 0 };
    },
  };

  const outcome = await orchestrate({ services, auditPath, statePath, baselinePath });
  const approved = calls.includes("approveScraper");
  const runCalls = calls.filter((c) => c === "runScraper").length;
  const healCalls = calls.filter((c) => c.startsWith("healScraper")).length;
  const syncCalls = calls.filter((c) => c.startsWith("syncToDownstream")).length;
  const auditExists = existsSync(auditPath);
  const triggerMatches = outcome.trigger === "found_existing_pending_heal";
  const decisionMatches = outcome.decision === "approved";
  // Key branch-(b) invariants: exactly ONE runScraper call (post-approve confirm
  // only — no initial run), and ZERO healScraper calls (reuse stored preview).
  // Phase 5 invariant: branch (b)→(e) approved path does sync to downstream
  // storage (the post-approve fresh scrape validated cleanly), with syncResult
  // recorded non-null in the audit entry.
  const pass = approved && runCalls === 1 && healCalls === 0 && triggerMatches && decisionMatches && auditExists
    && syncCalls === 1 && outcome.auditEntry.syncResult !== null;
  return {
    name: "branch (b): reuses pending heal preview, no new heal, approves + confirms",
    pass,
    detail: pass
      ? `approved=${approved}, runScraper=${runCalls} (expected 1), healScraper=${healCalls} (expected 0), syncToDownstream=${syncCalls}, trigger=${outcome.trigger}, decision=${outcome.decision}`
      : `approved=${approved}, runScraper=${runCalls} (expected 1), healScraper=${healCalls} (expected 0), syncToDownstream=${syncCalls}, trigger=${outcome.trigger}, decision=${outcome.decision}, syncResult=${JSON.stringify(outcome.auditEntry.syncResult)}, auditExists=${auditExists}`,
  };
}

function report(results: TestResult[]): void {
  let allOk = true;
  for (const r of results) {
    if (!r.pass) allOk = false;
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.name}`);
    if (r.detail.length > 0) console.log(`        ${r.detail}`);
    console.log("");
  }
  if (allOk) {
    console.log("All orchestrator assertions passed.");
    process.exit(0);
  } else {
    console.error("One or more orchestrator assertions FAILED.");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const results: TestResult[] = [
    await testComposeHealPrompt(),
    await testPreviewModeSkipsPopulationRules(),
    await testDecisionApprovesOnPassingPreview(),
    await testDecisionEscalatesOnFailingPreview(),
    await testBranchBReusesPendingPreviewWithoutNewHeal(),
  ];
  report(results);
}

void main();
