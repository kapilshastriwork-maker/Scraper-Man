import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = process.cwd();
const DEFAULT_AUDIT_PATH = resolve(REPO_ROOT, "orchestrator", "audit-log.jsonl");
const DEFAULT_OUT_PATH = resolve(REPO_ROOT, "downstream", "timeline.html");

interface SyncSummary {
  added: number;
  updated: number;
  closedOut: number;
}

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
  syncResult?: SyncSummary | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;")
    .replace(/'/g, "\u0026#39;");
}

const TRIGGER_COLORS: Record<string, string> = {
  healthy_run_no_action:      "#16a34a",
  healed_and_approved:        "#2563eb",
  healed_and_escalated:       "#dc2626",
  found_existing_pending_heal:"#9333ea",
};

const DECISION_COLORS: Record<string, string> = {
  no_action:                    "#16a34a",
  approved:                     "#2563eb",
  escalated_preview_failed:     "#dc2626",
  escalated_final_validate_failed: "#dc2626",
};

function renderEntry(entry: AuditEntry): string {
  const triggerColor = TRIGGER_COLORS[entry.trigger] ?? "#525252";
  const decisionColor = DECISION_COLORS[entry.decision] ?? "#525252";
  const fullReasoning = escapeHtml(entry.reasoning);
  const reasoningDisplay = entry.reasoning.length > 200
    ? escapeHtml(entry.reasoning.slice(0, 197) + "...")
    : fullReasoning;

  let syncLine = "";
  if (entry.syncResult) {
    const s = entry.syncResult;
    syncLine = `<div class="sync"><span class="lbl">storage:</span> ` +
      `<span class="add">+${s.added} added</span> · ` +
      `<span class="upd">~${s.updated} updated</span> · ` +
      `<span class="close">-${s.closedOut} closedOut</span></div>`;
  } else {
    syncLine = `<div class="sync none"><span class="lbl">storage:</span> not synced (escalation or pre-Phase-5 entry)</div>`;
  }

  return `    <li class="entry decision-${entry.decision}">
      <div class="row top-row">
        <time datetime="${escapeHtml(entry.timestamp)}">${escapeHtml(entry.timestamp)}</time>
        <span class="trigger" style="border-color:${triggerColor};color:${triggerColor}">${escapeHtml(entry.trigger)}</span>
        <span class="decision" style="border-color:${decisionColor};color:${decisionColor}">${escapeHtml(entry.decision)}</span>
      </div>
      <div class="row validation">${escapeHtml(entry.validationResultSummary)}</div>
      <div class="row reasoning" title="${fullReasoning}">${reasoningDisplay}</div>
      ${syncLine}
    </li>`;
}

function renderPage(entries: AuditEntry[]): string {
  const items = entries.map(renderEntry).join("\n");
  const count = entries.length;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Orchestrator Audit Timeline</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      --bg: #fafaf9; --card: #ffffff; --ink: #18181b; --muted: #71717a;
      --line: #e4e4e7; --hover: #f4f4f5;
      --add: #16a34a; --upd: #2563eb; --close: #dc2626;
    }
    @media (prefers-color-scheme: dark) {
      :root { --bg:#09090b; --card:#18181b; --ink:#fafafa; --muted:#a1a1aa; --line:#27272a; --hover:#27272a; }
    }
    * { box-sizing: border-box; }
    body {
      font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg); color: var(--ink); margin: 0; padding: 24px 16px 64px;
    }
    header { max-width: 960px; margin: 0 auto 24px; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    .subtitle { color: var(--muted); font-size: 13px; }
    ol { list-style: none; max-width: 960px; margin: 0 auto; padding: 0; counter-reset: entry; }
    .entry {
      counter-increment: entry; background: var(--card); border: 1px solid var(--line);
      border-radius: 8px; padding: 14px 16px; margin-bottom: 10px; transition: background .12s;
    }
    .entry:hover { background: var(--hover); }
    .row { margin: 3px 0; }
    .top-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    time { font-variant-numeric: tabular-nums; font-size: 13px; color: var(--muted); white-space: nowrap; }
    .trigger, .decision {
      display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: .02em;
      padding: 2px 8px; border-radius: 999px; border: 1px solid; background: transparent;
      text-transform: uppercase; white-space: nowrap;
    }
    .validation { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--muted); }
    .reasoning { color: var(--ink); }
    .sync { font-size: 12px; color: var(--muted); padding-top: 6px; border-top: 1px dashed var(--line); margin-top: 8px; }
    .sync .lbl { font-weight: 600; color: var(--muted); }
    .sync .add { color: var(--add); font-weight: 600; }
    .sync .upd  { color: var(--upd);  font-weight: 600; }
    .sync .close{ color: var(--close);font-weight: 600; }
    .sync.none .lbl { color: var(--muted); }
    .empty { text-align: center; color: var(--muted); padding: 64px 0; font-size: 14px; }
    footer { max-width: 960px; margin: 24px auto 0; color: var(--muted); font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>Orchestrator Audit Timeline</h1>
    <div class="subtitle">${count} ${count === 1 ? "entry" : "entries"} · reverse-chronological · self-contained static page</div>
  </header>
  <ol>
${items || '    <li class="empty">(no audit entries yet — run <code>npm run orchestrate</code> to populate)</li>'}
  </ol>
  <footer>
    Generated by <code>npm run timeline:build</code> from <code>orchestrator/audit-log.jsonl</code>.
    Regenerate this file after every orchestrate cycle to keep it in sync with the audit log.
  </footer>
</body>
</html>
`;
}

function main(): void {
  const auditPath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_AUDIT_PATH;
  const outPath = process.argv[3] ? resolve(process.cwd(), process.argv[3]) : DEFAULT_OUT_PATH;

  let entries: AuditEntry[] = [];
  if (existsSync(auditPath)) {
    const raw = readFileSync(auditPath, "utf8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch (err) {
        // Skip unparseable lines but warn to stderr — don't abort the whole render.
        console.error(`[timeline:build] skipping unparseable line: ${line.slice(0, 80)}... (${String(err)})`);
      }
    }
  }

  // Reverse chronological (newest first).
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const html = renderPage(entries);
  writeFileSync(outPath, Buffer.from(html, "utf8"));
  console.log(`[timeline:build] wrote ${outPath} (${entries.length} ${entries.length === 1 ? "entry" : "entries"})`);
}

main();
