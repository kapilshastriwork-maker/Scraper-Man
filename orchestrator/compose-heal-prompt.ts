import type { ValidationResult } from "../validator/validate.js";

/**
 * composeHealPrompt turns a ValidationResult's `diff` array into a single
 * plain-language paragraph suitable to pass directly to `bdata scraper heal`.
 *
 * Each rule gets a human-readable sentence. Sentences are joined with " Also, "
 * to form one paragraph. This is intentionally NOT a JSON.stringify of the
 * diff - the whole point is to give the Bright Data heal AI a natural-language
 * description of what broke, not a debugging payload.
 */
export function composeHealPrompt(result: ValidationResult): string {
  if (result.diff.length === 0) {
    return "";
  }
  const sentences: string[] = [];
  for (const entry of result.diff) {
    const sentence = sentenceForRule(entry);
    if (sentence.length > 0) sentences.push(sentence);
  }
  if (sentences.length === 0) return "";
  if (sentences.length === 1) return sentences[0];
  return sentences.join(" Also, ");
}

function sentenceForRule(entry: ValidationResult["diff"][number]): string {
  switch (entry.rule) {
    case "non_empty_array":
      return "The scraper returned an empty array - no job records at all. The careers page's job listings are no longer being extracted; the selector(s) for individual role cards are likely stale or the page structure has changed such that nothing matches.";

    case "required_fields_present": {
      const msg = entry.message;
      let s = `${msg} At least one of the job_title, location, or application_url selectors is no longer finding a value on each role card.`;
      if (entry.examples && entry.examples.length > 0) {
        const exSummaries = entry.examples.slice(0, 3).map((ex, i) => {
          if (ex && typeof ex === "object") {
            const rec = ex as Record<string, unknown>;
            const jt = rec["job_title"];
            const loc = rec["location"];
            const url = rec["application_url"];
            return `record ${i + 1} (job_title=${fmt(jt)}, location=${fmt(loc)}, application_url=${fmt(url)})`;
          }
          return `record ${i + 1} (${JSON.stringify(ex)})`;
        });
        s += ` Example broken record(s): ${exSummaries.join("; ")}.`;
      }
      return s;
    }

    case "row_count_sanity":
      return `${entry.message} The drop suggests the list of roles is being truncated, paginated differently, or the per-role selector is now matching a strict subset of the page.`;

    case "url_shape":
      return `${entry.message} The application_url selector is likely grabbing the wrong attribute (e.g. an anchor without href, or a non-link element).`;

    case "no_mass_duplication":
      return `${entry.message} The job_title selector is likely grabbing a repeated placeholder or nav element instead of the per-role title.`;

    default:
      return entry.message;
  }
}

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "(missing)";
  if (typeof v === "string" && v.trim().length === 0) return "(blank)";
  return JSON.stringify(v);
}
