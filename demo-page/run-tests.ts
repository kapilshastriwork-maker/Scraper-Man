import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeDemoOutput } from "./normalize-demo-output.js";

// ---------- Helpers ----------

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const REPO_ROOT = process.cwd();

const VALID_WRAPPED = [
  {
    job_listings: [
      { "job title": "Engineer A", location: "Remote (US)", "application url": "https://northwindlabs.example/apply/a" },
      { "job title": "Engineer B", location: "London, UK", "application url": "https://northwindlabs.example/apply/b" },
    ],
    input: { url: "https://kapilshastriwork-maker.github.io/Scraper-Man/demo-page/" },
  },
];

function assertEqual<T>(actual: T, expected: T, label: string): { ok: boolean; msg: string } {
  const ok = actual === expected;
  return { ok, msg: `${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}` };
}

// ---------- Tests ----------

function testValidWrappedShape(): TestResult {
  const out = normalizeDemoOutput(VALID_WRAPPED);
  const checks = [
    assertEqual(out.length, 2, "record count"),
    assertEqual(out[0]?.job_title, "Engineer A", "first record job_title"),
    assertEqual(out[0]?.location, "Remote (US)", "first record location"),
    assertEqual(out[0]?.application_url, "https://northwindlabs.example/apply/a", "first record application_url"),
  ];
  const ok = checks.every((c) => c.ok);
  return {
    name: "valid wrapped shape ({job_listings, input}, space keys) -> flat records with aliased keys",
    pass: ok,
    detail: ok ? `records=${out.length}` : checks.map((c) => c.msg).join(" | "),
  };
}

function testRealCommittedRawOutput(): TestResult {
  // The committed raw evidence from the live collector must normalize to the
  // exact 6 baseline records.
  const rawText = readFileSync(resolve(REPO_ROOT, "demo-page", "demo-raw-output.json"), "utf8");
  const out = normalizeDemoOutput(JSON.parse(rawText));
  const baseline = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "demo-page", "demo-baseline-output.json"), "utf8"),
  );
  const matchesBaseline = JSON.stringify(out) === JSON.stringify(baseline);
  return {
    name: "committed demo-raw-output.json normalizes byte-equal to demo-baseline-output.json",
    pass: out.length === 6 && matchesBaseline,
    detail: `records=${out.length}, matchesBaseline=${matchesBaseline}`,
  };
}

function testAlreadyFlatPassThrough(): TestResult {
  const flat = [
    { job_title: "Flat A", location: "Remote", application_url: "https://northwindlabs.example/apply/fa" },
    { job_title: "Flat B", location: "NYC", application_url: "https://northwindlabs.example/apply/fb" },
  ];
  const out = normalizeDemoOutput(flat);
  const ok = JSON.stringify(out) === JSON.stringify(flat);
  return {
    name: "already-flat input passes through untouched",
    pass: ok,
    detail: `roundTripIdentical=${ok}`,
  };
}

function testMissingJobListingsKey(): TestResult {
  const out = normalizeDemoOutput([{ input: { url: "https://example.com" } }]);
  return {
    name: "wrapper present but job_listings key MISSING -> [] (validator non_empty_array catches)",
    pass: Array.isArray(out) && out.length === 0,
    detail: `result=${JSON.stringify(out)}`,
  };
}

function testNonArrayJobListings(): TestResult {
  const out = normalizeDemoOutput([{ job_listings: "garbage", input: {} }]);
  return {
    name: "job_listings present but NOT an array -> []",
    pass: Array.isArray(out) && out.length === 0,
    detail: `result=${JSON.stringify(out)}`,
  };
}

function testNoWrapperAtAll(): TestResult {
  const a = normalizeDemoOutput([{ foo: "bar" }]);
  const b = normalizeDemoOutput({ notAnArray: true });
  const c = normalizeDemoOutput(null);
  const d = normalizeDemoOutput([]);
  const allEmpty = [a, b, c, d].every((r) => Array.isArray(r) && r.length === 0);
  return {
    name: "no wrapper / non-array root / null / empty array -> []",
    pass: allEmpty,
    detail: `results=[${a.length},${b.length},${c.length},${d.length}]`,
  };
}

function testEmptyJobListings(): TestResult {
  const out = normalizeDemoOutput([{ job_listings: [], input: {} }]);
  return {
    name: "empty job_listings array -> []",
    pass: Array.isArray(out) && out.length === 0,
    detail: `result=${JSON.stringify(out)}`,
  };
}

function testPartialRecordFailsClosed(): TestResult {
  const partial = [
    {
      job_listings: [
        { "job title": "Complete Role", location: "Remote", "application url": "https://northwindlabs.example/apply/ok" },
        { "job title": "Broken Role", location: "Remote" },
      ],
      input: {},
    },
  ];
  const out = normalizeDemoOutput(partial);
  return {
    name: "one partial record among valid ones fails closed to [] (never silently drops records)",
    pass: Array.isArray(out) && out.length === 0,
    detail: `result=${JSON.stringify(out)}`,
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
    console.log("All normalize-demo-output assertions passed.");
    process.exit(0);
  } else {
    console.error("One or more normalize-demo-output assertions FAILED.");
    process.exit(1);
  }
}

function main(): void {
  const results: TestResult[] = [
    testValidWrappedShape(),
    testRealCommittedRawOutput(),
    testAlreadyFlatPassThrough(),
    testMissingJobListingsKey(),
    testNonArrayJobListings(),
    testNoWrapperAtAll(),
    testEmptyJobListings(),
    testPartialRecordFailsClosed(),
  ];
  report(results);
}

main();
