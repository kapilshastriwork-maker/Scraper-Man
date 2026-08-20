export type ValidationMode = "full" | "preview";

export type ValidationResult = {
  pass: boolean;
  recordCount: number;
  baselineCount: number;
  diff: Array<{ rule: string; severity: "fail"; message: string; examples?: unknown[] }>;
};

const REQUIRED_FIELDS = ["job_title", "location", "application_url"] as const;
const REQUIRED_FIELD_RATIO = 0.1;
const URL_SHAPE_RATIO = 0.1;
const DUPLICATION_RATIO = 0.5;
const ROW_COUNT_RATIO = 0.5;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validate(
  runOutput: unknown,
  baseline: unknown,
  mode: ValidationMode = "full",
): ValidationResult {
  const diff: ValidationResult["diff"] = [];

  const baselineCount = Array.isArray(baseline) ? baseline.length : 0;
  const recordCount = Array.isArray(runOutput) ? runOutput.length : 0;

  if (!Array.isArray(runOutput) || runOutput.length === 0) {
    diff.push({
      rule: "non_empty_array",
      severity: "fail",
      message:
        "Output is not a non-empty array - this is the textbook layout-break signature (the scraper returned nothing scrapeable).",
    });
    return { pass: false, recordCount, baselineCount, diff };
  }

  const records = runOutput.filter(isRecord) as Record<string, unknown>[];

  const requiredBrokenExamples: unknown[] = [];
  let requiredBrokenCount = 0;
  for (const rec of records) {
    let brokenInThisRecord = false;
    for (const field of REQUIRED_FIELDS) {
      if (!isNonEmptyString(rec[field])) {
        brokenInThisRecord = true;
        break;
      }
    }
    if (brokenInThisRecord) {
      requiredBrokenCount += 1;
      if (requiredBrokenExamples.length < 3) {
        requiredBrokenExamples.push(rec);
      }
    }
  }
  if (records.length > 0 && requiredBrokenCount / records.length > REQUIRED_FIELD_RATIO) {
    diff.push({
      rule: "required_fields_present",
      severity: "fail",
      message: `${requiredBrokenCount} of ${records.length} records (${(requiredBrokenCount / records.length * 100).toFixed(1)}%) are missing or have a blank value for a required field (job_title, location, or application_url). Threshold is ${REQUIRED_FIELD_RATIO * 100}%.`,
      examples: requiredBrokenExamples,
    });
  }

  // row_count_sanity is skipped in preview mode: a heal preview is a small sample
  // (often 1 record), not the full population, so a count-vs-baseline comparison is
  // meaningless and would always false-fire. Only checked at full population scale.
  if (mode === "full" &&
    baselineCount > 0 &&
    recordCount < baselineCount * ROW_COUNT_RATIO
  ) {
    diff.push({
      rule: "row_count_sanity",
      severity: "fail",
      message: `Run returned ${recordCount} records, which is below ${ROW_COUNT_RATIO * 100}% of the baseline's ${baselineCount}. Natural drift should not halve the role list - likely a layout break.`,
    });
  }

  let urlBrokenCount = 0;
  for (const rec of records) {
    const url = rec["application_url"];
    if (typeof url !== "string" || !url.startsWith("http")) {
      urlBrokenCount += 1;
    }
  }
  if (records.length > 0 && urlBrokenCount / records.length > URL_SHAPE_RATIO) {
    diff.push({
      rule: "url_shape",
      severity: "fail",
      message: `${urlBrokenCount} of ${records.length} records (${(urlBrokenCount / records.length * 100).toFixed(1)}%) have an application_url that does not start with "http". Threshold is ${URL_SHAPE_RATIO * 100}%.`,
    });
  }

  const titleCounts = new Map<string, number>();
  let countedForDuplication = 0;
  for (const rec of records) {
    const rawTitle = rec["job_title"];
    if (rawTitle === undefined || rawTitle === null) continue;
    const key = String(rawTitle);
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
    countedForDuplication += 1;
  }
  let maxTitleCluster = 0;
  let maxTitleValue = "";
  for (const [title, count] of titleCounts) {
    if (count > maxTitleCluster) {
      maxTitleCluster = count;
      maxTitleValue = title;
    }
  }
  // no_mass_duplication is skipped in preview mode: a heal preview's sample size is
  // too small for a 50%-of-records threshold to be meaningful - a single record is
  // always 100% "duplicated" against itself. Only checked at full population scale.
  if (mode === "full" &&
    countedForDuplication > 0 &&
    maxTitleCluster / countedForDuplication > DUPLICATION_RATIO
  ) {
    diff.push({
      rule: "no_mass_duplication",
      severity: "fail",
      message: `${maxTitleCluster} of ${countedForDuplication} records (${(maxTitleCluster / countedForDuplication * 100).toFixed(1)}%) share the identical job_title "${maxTitleValue}" - signature of a scraper grabbing a repeated placeholder/nav element instead of real job cards. Threshold is ${DUPLICATION_RATIO * 100}%.`,
    });
  }

  return {
    pass: diff.length === 0,
    recordCount,
    baselineCount,
    diff,
  };
}
