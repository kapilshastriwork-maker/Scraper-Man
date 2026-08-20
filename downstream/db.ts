import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

export interface JobRecord {
  application_url: string;
  job_title: string | null;
  location: string | null;
  location_type?: string | null;
  product_page_url?: string | null;
  department?: string | null;
}

export interface SyncSummary {
  added: number;
  updated: number;
  closedOut: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  application_url   TEXT PRIMARY KEY,
  job_title         TEXT,
  location          TEXT,
  location_type     TEXT,
  product_page_url  TEXT,
  first_seen_at     TEXT,
  last_seen_at      TEXT,
  is_active         INTEGER,
  department        TEXT NULL
);
`;

function coercibleString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  return null;
}

export function initDb(dbPath: string): Database.Database {
  if (!existsSync(dirname(dbPath))) {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

function normalizeRecord(raw: unknown): JobRecord {
  const rec = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const appUrl = coercibleString(rec.application_url);
  if (!appUrl) {
    throw new Error(`syncJobs: record missing/blank application_url — cannot sync (got: ${JSON.stringify(raw).slice(0, 120)})`);
  }
  return {
    application_url: appUrl,
    job_title: coercibleString(rec.job_title),
    location: coercibleString(rec.location),
    location_type: coercibleString(rec.location_type),
    product_page_url: coercibleString(rec.product_page_url),
    department: coercibleString(rec.department),
  };
}


export function syncJobs(dbPath: string, records: unknown[], runTimestamp: string): SyncSummary {
  const db = initDb(dbPath);
  try {
    return db.transaction((): SyncSummary => {
      let added = 0;
      let updated = 0;

      const upsert = db.prepare(`
        INSERT INTO jobs (application_url, job_title, location, location_type, product_page_url, first_seen_at, last_seen_at, is_active, department)
        VALUES (@application_url, @job_title, @location, @location_type, @product_page_url, @first_seen_at, @last_seen_at, 1, @department)
        ON CONFLICT(application_url) DO UPDATE SET
          job_title        = excluded.job_title,
          location         = excluded.location,
          location_type    = excluded.location_type,
          product_page_url = excluded.product_page_url,
          last_seen_at     = excluded.last_seen_at,
          is_active        = 1,
          department       = excluded.department
      `);

      const existingUrlsStmt = db.prepare(`SELECT application_url FROM jobs WHERE is_active = 1`);
      const seenThisRun = new Set<string>();

      for (const raw of records) {
        const rec = normalizeRecord(raw);
        const existing = db.prepare(`SELECT 1 FROM jobs WHERE application_url = ?`).get(rec.application_url);
        upsert.run({
          application_url: rec.application_url,
          job_title: rec.job_title,
          location: rec.location,
          location_type: rec.location_type,
          product_page_url: rec.product_page_url,
          first_seen_at: runTimestamp,
          last_seen_at: runTimestamp,
          department: rec.department,
        });
        seenThisRun.add(rec.application_url);
        if (existing) updated += 1; else added += 1;
      }

      const activeBefore = existingUrlsStmt.all() as Array<{ application_url: string }>;
      let closedOut = 0;
      const closeStmt = db.prepare(`UPDATE jobs SET is_active = 0 WHERE application_url = ? AND is_active = 1`);
      for (const row of activeBefore) {
        if (!seenThisRun.has(row.application_url)) {
          closeStmt.run(row.application_url);
          closedOut += 1;
        }
      }

      return { added, updated, closedOut };
    })();
  } finally {
    db.close();
  }
}

export function getActiveJobs(dbPath: string): JobRecord[] {
  if (!existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare(
      `SELECT application_url, job_title, location, location_type, product_page_url, department
       FROM jobs WHERE is_active = 1
       ORDER BY first_seen_at DESC, application_url ASC`
    ).all() as JobRecord[];
    return rows;
  } finally {
    db.close();
  }
}
