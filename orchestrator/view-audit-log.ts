import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = process.cwd();
const DEFAULT_AUDIT_PATH = resolve(REPO_ROOT, "orchestrator", "audit-log.jsonl");

interface AuditEntry {
  timestamp: string;
  trigger: string;
  validationResultSummary: string;
  healPromptSent: string | null;
  collectorStateBefore: string;
  collectorStateAfter: string;
  previewResultSummary: unknown[];
  decision: string;
  reasoning: string;
  syncResult?: { added: number; updated: number; closedOut: number } | null;
}

function main(): void {
  const auditPath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_AUDIT_PATH;
  if (!existsSync(auditPath)) {
    console.log("(no audit log entries yet)");
    process.exit(0);
  }
  const raw = readFileSync(auditPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    console.log("(no audit log entries yet)");
    process.exit(0);
  }
  console.log(`Orchestrator audit timeline (${lines.length} entries):\n`);
  for (const line of lines) {
    let entry: AuditEntry;
    try {
      entry = JSON.parse(line) as AuditEntry;
    } catch (err) {
      console.log(`  [unparseable line] ${line.slice(0, 80)}...`);
      continue;
    }
    const reasoning = entry.reasoning.length > 140 ? entry.reasoning.slice(0, 137) + "..." : entry.reasoning;
    const syncLine = entry.syncResult
      ? ` | sync: +${entry.syncResult.added} ~${entry.syncResult.updated} -${entry.syncResult.closedOut}`
      : "";
    console.log(`${entry.timestamp} | ${entry.trigger} | ${entry.decision} | ${reasoning}${syncLine}`);
  }
}

main();
