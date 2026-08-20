import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { initDb, syncJobs, getActiveJobs } from "./db.js";

// ---------- Helpers ----------

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

function makeRecords(count: number, prefix: string, startingIndex: number = 0): unknown[] {
  const records: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const idx = startingIndex + i;
    records.push({
      job_title: `${prefix} Role ${idx}`,
      location: "San Francisco Bay Area",
      location_type: "On-site",
      application_url: `https://jobs.ashbyhq.com/retell-ai/test-${idx}/application`,
      product_page_url: `https://jobs.ashbyhq.com/retell-ai/test-${idx}`,
    });
  }
  return records;
}

function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "downstream-test-"));
  return join(dir, "test.db");
}

function assertEqual<T>(actual: T, expected: T, label: string): { ok: boolean; msg: string } {
  const ok = actual === expected;
  return { ok, msg: `${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}` };
}

function getRowCount(dbPath: string, whereClause: string = ""): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM jobs ${whereClause}`).get() as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

function getRow(dbPath: string, applicationUrl: string): { application_url: string; is_active: number; job_title: string | null } | undefined {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(`SELECT application_url, is_active, job_title FROM jobs WHERE application_url = ?`)
      .get(applicationUrl) as { application_url: string; is_active: number; job_title: string | null } | undefined;
  } finally {
    db.close();
  }
}

// ---------- Tests ----------

function testInitDbCreatesFileAndSchema(): TestResult {
  const dbPath = freshDbPath();
  if (existsSync(dbPath)) {
    return { name: "initDb: creates a new db file + jobs table when missing", pass: false, detail: `dbPath existed before initDb call (cross-test contamination): ${dbPath}` };
  }
  const db = initDb(dbPath);
  db.close();
  const fileExists = existsSync(dbPath);
  // Re-open verify the table is queryable.
  const check = getRowCount(dbPath);
  const pass = fileExists && check === 0;
  return {
    name: "initDb: creates a new db file + jobs table when missing",
    pass,
    detail: pass
      ? `fileExists=${fileExists}, jobs table queryable (count=0).`
      : `fileExists=${fileExists}, jobs table count after init=${check}.`,
  };
}

function testFirstSyncAllNew(): TestResult {
  const dbPath = freshDbPath();
  initDb(dbPath);
  const records = makeRecords(10, "Initial");
  const summary = syncJobs(dbPath, records, "2026-08-21T10:00:00Z");

  const checks = [
    assertEqual(summary.added, 10, "added"),
    assertEqual(summary.updated, 0, "updated"),
    assertEqual(summary.closedOut, 0, "closedOut"),
  ];
  const tableCount = getRowCount(dbPath);
  checks.push(assertEqual(tableCount, 10, "table row count after first sync"));

  const ok = checks.every((c) => c.ok);
  return {
    name: "first sync: 10 new records → added=10, updated=0, closedOut=0, no rows closed",
    pass: ok,
    detail: ok ? `added=${summary.added}, updated=${summary.updated}, closedOut=${summary.closedOut}, rows=${tableCount}` : checks.map((c) => c.msg).join(" | "),
  };
}

function testSecondSyncSameDataIsIdempotent(): TestResult {
  const dbPath = freshDbPath();
  initDb(dbPath);
  const records = makeRecords(10, "Initial");
  syncJobs(dbPath, records, "2026-08-21T10:00:00Z");
  const summary = syncJobs(dbPath, records, "2026-08-21T11:00:00Z");

  const checks = [
    assertEqual(summary.added, 0, "added"),
    assertEqual(summary.updated, 10, "updated"),
    assertEqual(summary.closedOut, 0, "closedOut"),
  ];
  const tableCount = getRowCount(dbPath);
  checks.push(assertEqual(tableCount, 10, "table row count after second sync"));

  // Confirm last_seen_at advanced and first_seen_at preserved.
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(`SELECT first_seen_at, last_seen_at FROM jobs WHERE application_url = ?`)
      .get("https://jobs.ashbyhq.com/retell-ai/test-0/application") as { first_seen_at: string; last_seen_at: string };
    checks.push(assertEqual(row.first_seen_at, "2026-08-21T10:00:00Z", "first_seen_at preserved"));
    checks.push(assertEqual(row.last_seen_at, "2026-08-21T11:00:00Z", "last_seen_at advanced"));
  } finally {
    db.close();
  }

  const ok = checks.every((c) => c.ok);
  return {
    name: "second sync with identical records → added=0, updated=10, closedOut=0 (idempotent re-sync)",
    pass: ok,
    detail: ok ? `added=${summary.added}, updated=${summary.updated}, closedOut=${summary.closedOut}, rows=${tableCount}` : checks.map((c) => c.msg).join(" | "),
  };
}

function testThirdSyncDropsOneAddsOne(): TestResult {
  const dbPath = freshDbPath();
  initDb(dbPath);
  const original = makeRecords(10, "Initial");
  syncJobs(dbPath, original, "2026-08-21T10:00:00Z");
  syncJobs(dbPath, original, "2026-08-21T11:00:00Z");

  // Drop test-9, keep test-0..test-8 (9 records) + add test-100 (1 record). Total: 10.
  const shifted = [
    ...makeRecords(9, "Initial", 0),
    ...makeRecords(1, "Newcomer", 100),
  ];
  const summary = syncJobs(dbPath, shifted, "2026-08-21T12:00:00Z");

  const checks = [
    assertEqual(summary.added, 1, "added (only test-100)"),
    assertEqual(summary.updated, 9, "updated (test-0..8)"),
    assertEqual(summary.closedOut, 1, "closedOut (test-9)"),
  ];

  // Critical: vanished row is NOT deleted, only is_active flipped to 0.
  const totalRows = getRowCount(dbPath);
  checks.push(assertEqual(totalRows, 11, "total row count (10 original + 1 new, none deleted)"));
  const activeRows = getRowCount(dbPath, "WHERE is_active = 1");
  checks.push(assertEqual(activeRows, 10, "active row count (9 surviving + 1 new)"));
  const closedRow = getRow(dbPath, "https://jobs.ashbyhq.com/retell-ai/test-9/application");
  const closedOk = closedRow !== undefined && closedRow.is_active === 0;
  checks.push({ ok: closedOk, msg: `closedRow still exists & is_active=0: ${JSON.stringify(closedRow)}` });

  const ok = checks.every((c) => c.ok);
  return {
    name: "third sync drops one URL + adds one → closedOut=1, added=1, updated=9; vanished row persists with is_active=0 (not deleted)",
    pass: ok,
    detail: ok
      ? `added=${summary.added}, updated=${summary.updated}, closedOut=${summary.closedOut}, totalRows=${totalRows}, activeRows=${activeRows}`
      : checks.map((c) => c.msg).join(" | "),
  };
}

function testGetActiveJobsExcludesClosed(): TestResult {
  const dbPath = freshDbPath();
  initDb(dbPath);
  const original = makeRecords(8, "Initial");
  syncJobs(dbPath, original, "2026-08-21T10:00:00Z");
  // Close out half of them by sending only the first 4.
  syncJobs(dbPath, makeRecords(4, "Initial", 0), "2026-08-21T11:00:00Z");

  const active = getActiveJobs(dbPath);
  const checks = [
    assertEqual(active.length, 4, "getActiveJobs count"),
    assertEqual(getRowCount(dbPath), 8, "total rows preserved (closed rows still in DB)"),
  ];
  const ok = checks.every((c) => c.ok);
  return {
    name: "getActiveJobs: returns only is_active=1 rows, closed-out rows remain in the table",
    pass: ok,
    detail: ok ? `activeRows=${active.length}, totalRowsInDB=${getRowCount(dbPath)}` : checks.map((c) => c.msg).join(" | "),
  };
}

// ---------- Runner ----------

function report(results: TestResult[]): void {
  let allOk = true;
  for (const r of results) {
    if (!r.pass) allOk = false;
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.name}`);
    if (r.detail.length > 0) console.log(`        ${r.detail}`);
    console.log("");
  }
  if (allOk) {
    console.log("All downstream assertions passed.");
    process.exit(0);
  } else {
    console.error("One or more downstream assertions FAILED.");
    process.exit(1);
  }
}

function main(): void {
  const results: TestResult[] = [
    testInitDbCreatesFileAndSchema(),
    testFirstSyncAllNew(),
    testSecondSyncSameDataIsIdempotent(),
    testThirdSyncDropsOneAddsOne(),
    testGetActiveJobsExcludesClosed(),
  ];
  report(results);
}

main();
