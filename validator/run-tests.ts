import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validate } from "./validate";

const REPO_ROOT = process.cwd();
const BASELINE_PATH = resolve(REPO_ROOT, "scraper", "baseline-output.json");
const FIXTURES_DIR = resolve(REPO_ROOT, "validator", "test-fixtures");

interface FixtureSpec {
  name: string;
  file: string;
  expectPass: boolean;
  expectFailRules: string[];
}

const FIXTURES: FixtureSpec[] = [
  {
    name: "passing-real-baseline.json",
    file: "passing-real-baseline.json",
    expectPass: true,
    expectFailRules: [],
  },
  {
    name: "failing-empty-array.json",
    file: "failing-empty-array.json",
    expectPass: false,
    expectFailRules: ["non_empty_array"],
  },
  {
    name: "failing-high-nulls.json",
    file: "failing-high-nulls.json",
    expectPass: false,
    expectFailRules: ["required_fields_present"],
  },
];

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(): void {
  const baseline = loadJson(BASELINE_PATH);
  let allOk = true;

  for (const fixture of FIXTURES) {
    const fixturePath = resolve(FIXTURES_DIR, fixture.file);
    const runOutput = loadJson(fixturePath);
    const result = validate(runOutput, baseline);

    const actualPass = result.pass;
    const actualFailRules = result.diff.map((d) => d.rule);

    const passMatches = actualPass === fixture.expectPass;
    const failRulesMatch =
      fixture.expectFailRules.length === actualFailRules.length &&
      fixture.expectFailRules.every((r, i) => r === actualFailRules[i]);

    const ok = passMatches && failRulesMatch;
    if (!ok) allOk = false;

    const status = ok ? "PASS" : "FAIL";
    console.log(`[${status}] ${fixture.name}`);
    console.log(`        expected: ${fixture.expectPass ? "pass" : "fail"} on [${fixture.expectFailRules.join(", ")}]`);
    console.log(`        actual:   ${actualPass ? "pass" : "fail"} on [${actualFailRules.join(", ")}]`);
    if (!ok && actualFailRules.length > 0) {
      for (const entry of result.diff) {
        console.log(`          - [${entry.rule}] ${entry.message}`);
      }
    }
    console.log("");
  }

  if (allOk) {
    console.log("All fixture assertions passed.");
    process.exit(0);
  } else {
    console.error("One or more fixture assertions FAILED.");
    process.exit(1);
  }
}

main();
