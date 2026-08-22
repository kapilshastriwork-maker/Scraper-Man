// WHY THIS FILE EXISTS (read before "fixing" it away):
//
// The Bright Data platform refuses to emit the demo target's output in the flat
// shape this project's schema requires, despite every attempt to prompt it into
// doing so. Evidence (all raw artifacts committed under orchestrator/recon/):
//
//   - TWO independently-created collectors against the same live page:
//       c_mt41d5pczex8zq60n  (created 2026-08-22T07:07Z)
//       c_mt41tsfb1160modp6z (created 2026-08-22T07:20Z)
//   - FOUR heal/create attempts total across them, all explicitly demanding a
//     flat top-level array with job_title/location/application_url keys.
//   - In BOTH heals the preview_result came back in the correct flat shape,
//     but the post-approve PRODUCTION output reverted to the platform's own
//     inferred schema: [{ job_listings: [...], input: {...} }] with keys
//     "job title" / "application url" (spaces) or job_location / job_apply_url.
//     Recon: demo-create-2/3, demo-run-4..7, demo-heal-3/4, demo-approve-3/4.
//
// This is a reproducible platform behavior, NOT a prompting failure. Rather than
// keep iterating on prompts or violate the project's "no local extraction code"
// policy, this adapter draws the line explicitly: it performs ZERO extraction —
// no HTML parsing, no selectors, no decisions about what counts as a role. It
// only reshapes values the platform already extracted correctly, every time
// (6/6 records, value-perfect, on all four attempts). Reshaping already-extracted
// data is presentation-layer mapping; extraction stays in Scraper Studio.
//
// Scope: used ONLY on the --target=demo path (scraper/run-cli.ts + orchestrator).
// The real target's pipeline is untouched by this file.

export interface DemoJobRecord {
  job_title: string;
  location: string;
  application_url: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const KEY_ALIASES: Record<string, keyof DemoJobRecord> = {
  job_title: "job_title",
  location: "location",
  application_url: "application_url",
  // space-keyed variants observed in production output of both collectors:
  "job title": "job_title",
  "application url": "application_url",
};

function mapRecord(rec: unknown): DemoJobRecord | null {
  if (!isRecord(rec)) return null;
  const out: Partial<DemoJobRecord> = {};
  let matched = 0;
  for (const [rawKey, value] of Object.entries(rec)) {
    const mapped = KEY_ALIASES[rawKey];
    if (mapped === undefined) continue; // drops the `input` echo and anything else
    if (typeof value !== "string" || value.trim() === "") continue;
    out[mapped] = value;
    matched += 1;
  }
  if (matched < 3) return null;
  return out as DemoJobRecord;
}

/**
 * Pure reshape of the Bright Data demo collector's raw output into the flat
 * array shape config/schema.json requires. Accepts either the observed wrapped
 * shape ([{ job_listings: [...], input: {...} }]) or an already-flat array
 * (pass-through, in case production ever starts emitting the requested shape).
 * Throws on any other shape rather than silently returning partial data.
 */
export function normalizeDemoOutput(raw: unknown): DemoJobRecord[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      "normalizeDemoOutput: raw output is not a non-empty array - refusing to guess.",
    );
  }

  // Already-flat pass-through: every element maps cleanly under known keys.
  const asFlat = raw.map(mapRecord);
  if (asFlat.every((r): r is DemoJobRecord => r !== null)) {
    return asFlat;
  }

  // Wrapped shape: exactly one wrapper object carrying a job_listings array.
  const wrappers = raw.filter(
    (el): el is Record<string, unknown> =>
      isRecord(el) && Array.isArray(el["job_listings"]),
  );
  if (wrappers.length !== 1) {
    throw new Error(
      `normalizeDemoOutput: expected 1 wrapper object with a job_listings array, found ${wrappers.length}. Raw first element: ${JSON.stringify(raw[0]).slice(0, 300)}`,
    );
  }
  const listings = wrappers[0]["job_listings"] as unknown[];
  const mapped = listings.map((rec) => {
    const job = mapRecord(rec);
    if (job === null) {
      throw new Error(
        `normalizeDemoOutput: job_listings element missing one of the three required fields: ${JSON.stringify(rec).slice(0, 300)}`,
      );
    }
    return job;
  });
  if (mapped.length === 0) {
    throw new Error("normalizeDemoOutput: job_listings array is empty.");
  }
  return mapped;
}

// ---------- Direct-run CLI ----------
// Usage: npx tsx demo-page/normalize-demo-output.ts <rawInput.json> [output.json]
// Reads raw Bright Data output, writes normalized JSON (UTF-8 no BOM).
// With no output path, prints to stdout.

async function main(): Promise<void> {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: tsx demo-page/normalize-demo-output.ts <rawInput.json> [output.json]");
    process.exit(1);
  }
  // Strip a leading BOM if present - PowerShell redirection and some editors
  // add one, which breaks JSON.parse (same artifact hit during Phase 2).
  const rawText = readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
  const raw: unknown = JSON.parse(rawText);
  const normalized = normalizeDemoOutput(raw);
  const payload = Buffer.from(JSON.stringify(normalized, null, 2) + "\n", "utf8");
  const outputPath = process.argv[3];
  if (outputPath) {
    writeFileSync(outputPath, payload);
    console.log(`Normalized ${normalized.length} records -> ${outputPath}`);
  } else {
    process.stdout.write(payload);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  (await import("node:url")).fileURLToPath(import.meta.url) ===
    (await import("node:path")).resolve(process.argv[1]);
if (isMain) void main();
