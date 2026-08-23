// resume-tailor/generate.ts
//
// Standalone proof-of-concept: pick the most relevant projects from
// experience.md for a job posting, and draft tailored resume bullets - via
// Groq's free-tier OpenAI-compatible API.
//
// Two job sources:
//   npm run resume:generate -- "<job title>"
//       matches against the skills-demo scraped baseline (skills-demo/baseline-output.json)
//   npm run resume:generate -- --job-file <path>
//       reads the job posting from a file directly - the skills-demo lookup is
//       SKIPPED ENTIRELY. Title comes from the file's first markdown heading,
//       falling back to the filename stem.
//
// Stage 1 of 2. Writes resume-tailor/output/picks-<slug>.json, consumed by
// fill-template.ts (stage 2). No docx logic here.

import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b"; // verified current vs console.groq.com/docs/models + /docs/structured-outputs

const DEMO_BASELINE = resolve(process.cwd(), "skills-demo", "baseline-output.json");
const EXPERIENCE_PATH = resolve(process.cwd(), "resume-tailor", "experience.md");
const OUTPUT_DIR = resolve(process.cwd(), "resume-tailor", "output");

interface SkillsJobRecord {
  role: string;
  package: number;
  skills_required: string;
}

interface ProjectPick {
  projectName: string;
  reasoning: string;
  bullets: string[];
}

interface PicksResult {
  jobRole: string;
  matchedSkills: string;
  projects: ProjectPick[];
}

function fail(message: string): never {
  console.error(`\n[resume-tailor] ERROR: ${message}`);
  process.exit(1);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------- Groq strict-mode JSON schema (verified vs console.groq.com/docs/structured-outputs) ----------
// Strict mode requirements honored: all fields required, additionalProperties:false everywhere.
const PICKS_SCHEMA = {
  type: "object",
  properties: {
    projects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          projectName: { type: "string" },
          reasoning: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
        },
        required: ["projectName", "reasoning", "bullets"],
        additionalProperties: false,
      },
    },
  },
  required: ["projects"],
  additionalProperties: false,
} as const;

function buildPrompt(
  jobTitle: string,
  skillsRequired: string,
  experienceText: string,
  jobDescription = "",
): string {
  const jobLines = [
    `You are helping tailor a resume for this job: "${jobTitle}".`,
    `The job requires these skills: ${skillsRequired}.`,
  ];
  if (jobDescription.trim() !== "") {
    jobLines.push("", "Full job posting:", "--- JOB POSTING START ---", jobDescription, "--- JOB POSTING END ---");
  }
  return [
    ...jobLines,
    "",
    "Below is my full experience document containing descriptions of my projects.",
    "Pick up to 3 of the most relevant projects for this specific job, or all of them",
    "if fewer than 3 exist in experience.md.",
    'For each picked project, use its exact project name from the document as "projectName".',
    'In "reasoning" (1 sentence), say briefly why this project matters for THIS job.',
    'Write exactly 3 tailored first-person resume bullets per project in "bullets".',
    "Bullet rules: start with a strong past-tense verb; be concrete; where the source",
    "document gives numbers/metrics, keep them; connect the work to the job's skills",
    "where genuinely true - do NOT invent experience, technologies, or metrics that",
    "are not in the document.",
    "",
    "--- EXPERIENCE DOCUMENT START ---",
    experienceText,
    "--- EXPERIENCE DOCUMENT END ---",
  ].join("\n");
}

async function callGroq(prompt: string, apiKey: string): Promise<ProjectPick[]> {
  const body = {
    model: GROQ_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are an expert technical resume writer. You follow the user's instructions exactly and only use facts present in the provided document.",
      },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "resume_project_picks",
        strict: true,
        schema: PICKS_SCHEMA,
      },
    },
    temperature: 0.3,
  };

  const response = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    fail(`Groq API returned ${response.status} ${response.statusText}:\n${errText}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    fail(`Groq returned no message content. Full response:\n${JSON.stringify(json, null, 2)}`);
  }
  let parsed: { projects?: ProjectPick[] };
  try {
    parsed = JSON.parse(content) as { projects?: ProjectPick[] };
  } catch (err) {
    fail(`Groq content was not parseable JSON despite strict schema:\n${content}\n(parse error: ${err})`);
  }
  if (!Array.isArray(parsed.projects) || parsed.projects.length === 0) {
    fail(`Groq returned zero projects:\n${content}`);
  }
  return parsed.projects;
}

async function main(): Promise<void> {
  const jobFileFlagIdx = process.argv.indexOf("--job-file");
  console.log("[resume-tailor] stage 1: generate picks via Groq\n");

  // -- API key (dotenv already loaded via import) --
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    fail(
      "GROQ_API_KEY is not set.\n" +
        "Create a local .env file in the repo root with one line:\n" +
        "  GROQ_API_KEY=<your key from console.groq.com/keys>\n" +
        "(see .env.example). Get a free key at https://console.groq.com/keys.",
    );
  }

  // -- Job source --
  let jobTitle: string;
  let matchedSkills: string;
  let jobDescription = "";

  if (jobFileFlagIdx !== -1) {
    // --job-file path: skills-demo lookup is SKIPPED ENTIRELY.
    const filePath = process.argv[jobFileFlagIdx + 1];
    if (!filePath) {
      fail(
        'Usage: npm run resume:generate -- --job-file <path>\nExample: npm run resume:generate -- --job-file resume-tailor/target-job.md',
      );
    }
    if (!existsSync(filePath)) {
      fail(`--job-file: file not found: ${filePath}`);
    }
    const raw = readFileSync(filePath, "utf8").trim();
    if (raw === "") {
      fail(`--job-file: ${filePath} is empty. Paste the full job posting into it first.`);
    }
    // Title = first markdown heading (# ...) if present, else filename stem.
    const heading = /^#\s+(.+)$/m.exec(raw);
    jobTitle = heading ? heading[1].trim() : basename(filePath).replace(/\.[^.]+$/, "");
    jobDescription = raw;
    // Skills line for the prompt: use the heading-adjacent "Skills:" line if
    // the posting carries one; otherwise leave it to the description alone.
    const skillsLine = /^Skills:\s*(.+)$/im.exec(raw)?.[1];
    matchedSkills = skillsLine ?? "(see full job posting below)";
    console.log(`Job loaded from --job-file: "${jobTitle}"`);
    if (skillsLine) console.log(`Skills req.:  ${matchedSkills}`);
    console.log("");
  } else {
    // -- skills-demo baseline lookup (unchanged default behavior) --
    const jobArg = process.argv[2];
    if (!jobArg || jobArg.trim() === "") {
      fail('Usage: npm run resume:generate -- "<job title>"');
    }
    if (!existsSync(DEMO_BASELINE)) {
      fail(`Baseline not found at ${DEMO_BASELINE}. Run the skills-demo pipeline first.`);
    }
    const records = JSON.parse(readFileSync(DEMO_BASELINE, "utf8")) as SkillsJobRecord[];
    if (!Array.isArray(records) || records.length === 0) {
      fail(`${DEMO_BASELINE} contains no job records.`);
    }
    const needle = jobArg.trim().toLowerCase();
    const match = records.find((r) => r.role.toLowerCase().includes(needle));
    if (!match) {
      const available = records.map((r) => `  - ${r.role}`).join("\n");
      fail(
        `No job record matches "${jobArg}". Available roles in skills-demo/baseline-output.json:\n${available}`,
      );
    }
    jobTitle = match.role;
    matchedSkills = match.skills_required;
    console.log(`Matched job:  ${match.role} (package ${match.package} LPA)`);
    console.log(`Skills req.:  ${match.skills_required}\n`);
  }

  // -- Experience doc --
  if (!existsSync(EXPERIENCE_PATH)) {
    fail(`experience.md not found at ${EXPERIENCE_PATH}.`);
  }
  const experienceText = readFileSync(EXPERIENCE_PATH, "utf8").trim();
  const isStillSkeleton =
    experienceText.length === 0 ||
    (experienceText.includes("FILL THIS FILE WITH YOUR REAL CONTENT") &&
      experienceText.includes("FORMAT GUIDANCE"));
  if (isStillSkeleton) {
    fail(
      "experience.md is still empty/skeleton. Fill it with your real projects first\n" +
        "(see the format guidance inside the file), then re-run.",
    );
  }
  console.log(`experience.md loaded (${experienceText.length} chars).\n`);

  // -- Groq call --
  console.log(`Calling Groq (${GROQ_MODEL}, structured outputs, strict mode)...`);
  const prompt = buildPrompt(jobTitle, matchedSkills, experienceText, jobDescription);
  const projects = await callGroq(prompt, apiKey);

  console.log("\n--- MODEL PICKS ---");
  for (const p of projects) {
    console.log(`\n* ${p.projectName}`);
    console.log(`  why: ${p.reasoning}`);
    for (const b of p.bullets) {
      console.log(`   - ${b}`);
    }
  }
  console.log("\n--- END PICKS ---\n");

  const result: PicksResult = {
    jobRole: jobTitle,
    matchedSkills,
    projects,
  };
  const slug = slugify(jobTitle);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  // Single source of truth for the picks path: feeds the writeFileSync target
  // AND both printed lines, so the suggested next-step command is always
  // copy-pasteable from the repo root without manual correction.
  const picksRelPath = `resume-tailor/output/picks-${slug}.json`;
  writeFileSync(resolve(picksRelPath), Buffer.from(JSON.stringify(result, null, 2) + "\n", "utf8"));
  console.log(`Picks saved -> ${picksRelPath}`);
  console.log("\nNext step: ensure template.docx is in place (manual step, see README), then run:");
  console.log(`  npx tsx resume-tailor/fill-template.ts ${picksRelPath}`);
}

main().catch((err) => {
  console.error("\n[resume-tailor] Unexpected failure:", err);
  process.exit(1);
});
