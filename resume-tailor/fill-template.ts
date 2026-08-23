// resume-tailor/fill-template.ts
//
// Stage 2 of the resume PoC: splice Groq's project picks into a real .docx
// template WITHOUT reformatting anything else.
//
// Usage: npx tsx resume-tailor/fill-template.ts <picks.json>
//
// Manual prerequisite (see README): resume-tailor/template.docx must exist and
// contain a paragraph with the literal text {{PROJECTS_PLACEHOLDER}} plus at
// least one existing bullet paragraph (ListParagraph) whose list formatting is
// cloned for the generated bullets.
//
// Edit process follows the docx-skill standard: unzip to a working dir, edit
// word/document.xml IN PLACE (no pretty-printing/reformatting), rezip, then
// validate with scripts/validate.py --original template.docx. Any structural
// validation failure = stop and report, no guessed fixes.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, relative } from "node:path";

const RESUME_DIR = resolve(process.cwd(), "resume-tailor");
const TEMPLATE_PATH = resolve(RESUME_DIR, "template.docx");
const WORK_DIR = resolve(RESUME_DIR, ".docx-work");
const OUTPUT_DIR = resolve(RESUME_DIR, "output");

interface ProjectPick {
  projectName: string;
  reasoning?: string;
  bullets: string[];
}
interface PicksFile {
  jobRole: string;
  matchedSkills: string;
  projects: ProjectPick[];
}

function fail(message: string): never {
  console.error(`\n[resume-tailor] ERROR: ${message}`);
  cleanup();
  process.exit(1);
}

function cleanup(): void {
  if (existsSync(WORK_DIR)) rmSync(WORK_DIR, { recursive: true, force: true });
  // .docx-src.zip is written NEXT TO WORK_DIR (not inside it), so remove explicitly.
  const srcZip = resolve(RESUME_DIR, ".docx-src.zip");
  if (existsSync(srcZip)) rmSync(srcZip, { force: true });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Strip control chars illegal in XML 1.0.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/** Runs text through the runs' rPr of an existing paragraph (formatting clone). */
function extractTextFromParagraph(pXml: string): string {
  const texts = [...pXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]);
  return texts.join("");
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    if (statSync(s).isDirectory()) copyDirRecursive(s, d);
    else cpSync(s, d);
  }
}

function main(): void {
  console.log("[resume-tailor] stage 2: fill docx template\n");

  const picksArg = process.argv[2];
  if (!picksArg) {
    fail("Usage: npx tsx resume-tailor/fill-template.ts output/picks-<slug>.json");
  }
  const picksPath = resolve(picksArg);
  if (!existsSync(picksPath)) {
    fail(`Picks file not found: ${picksPath}\nRun stage 1 first: npm run resume:generate -- "<job title>"`);
  }
  if (!existsSync(TEMPLATE_PATH)) {
    fail(
      `Template not found at ${TEMPLATE_PATH}.\n` +
        "This file is a REQUIRED MANUAL STEP: create/edit your real resume in Word,\n" +
        'save it as resume-tailor/template.docx, and include a paragraph containing\n' +
        'the literal text {{PROJECTS_PLACEHOLDER}} where the projects section should\n' +
        'go. See resume-tailor/README.md for full instructions.',
    );
  }

  const picks = JSON.parse(readFileSync(picksPath, "utf8")) as PicksFile;
  if (!Array.isArray(picks.projects) || picks.projects.length === 0) {
    fail(`${picksPath} contains no projects.`);
  }
  console.log(`Picks loaded: ${picks.jobRole} -> ${picks.projects.length} projects\n`);

  // -- Unzip template into work dir --
  // ROOT CAUSE HISTORY: this used to be PS 5.1 `Expand-Archive`, which - like
  // Compress-Archive - mishandles wildcard characters in entry names and
  // silently skipped [Content_Types].xml during extraction. Replaced with
  // .NET ZipFile::ExtractToDirectory, which extracts every entry verbatim.
  const expandDir = resolve(WORK_DIR, "unzipped");
  mkdirSync(expandDir, { recursive: true });
  const expand = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
        "[System.IO.Compression.ZipFile]::ExtractToDirectory($env:DOCX_SRC_ZIP, $env:DOCX_DEST_DIR)",
    ],
    {
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, DOCX_SRC_ZIP: TEMPLATE_PATH, DOCX_DEST_DIR: expandDir },
    },
  );
  if (expand.status !== 0) {
    fail(`Failed to unzip template (exit ${expand.status}).`);
  }
  const docXmlPath = resolve(expandDir, "word", "document.xml");
  if (!existsSync(docXmlPath)) {
    fail("Unzipped template has no word/document.xml - not a valid docx?");
  }
  let docXml = readFileSync(docXmlPath, "utf8");

  // -- Locate placeholder paragraph --
  const PLACEHOLDER = "{{PROJECTS_PLACEHOLDER}}";
  const paraRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const paragraphs = [...docXml.matchAll(paraRegex)];
  const phMatch = paragraphs.find((m) => m[0].includes(PLACEHOLDER));
  if (!phMatch) {
    fail(
      `No paragraph contains the literal text ${PLACEHOLDER}. ` +
        "Edit template.docx so exactly one paragraph carries it.",
    );
  }
  const placeholderPara = phMatch[0];

  // -- Capture formatting templates BEFORE replacing anything --
  // Heading formatting: the placeholder paragraph's own pPr + its first run's rPr.
  const phPPR = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(placeholderPara)?.[0] ?? "";
  // \b + [^>]* so attribute-bearing runs (<w:r w:rsidRPr="...">) match too -
  // Word routinely puts rsid attributes on <w:r>, and missing them silently
  // dropped bold/color/font/size from generated project-name paragraphs.
  const phRPR =
    /<w:r\b[^>]*>(?:(?!<w:r\b).)*?(<w:rPr>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:r>/.exec(placeholderPara)?.[1] ?? "";

  // Bullet formatting template: nearest PRECEDING ListParagraph before the placeholder.
  let bulletParaXml: string | null = null;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const idx = paragraphs[i].index ?? -1;
    if (idx !== -1 && idx < (phMatch.index ?? -1) && paragraphs[i][0].includes('w:val="ListParagraph"')) {
      bulletParaXml = paragraphs[i][0];
      break;
    }
  }
  if (bulletParaXml === null) {
    fail(
      "No existing bullet paragraph (pStyle ListParagraph) found before the placeholder. " +
        "Add at least one bulleted item above it in template.docx so its list formatting can be cloned.",
    );
  }
  const bulletPPR = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(bulletParaXml)?.[0] ?? "";
  const bulletRPR =
    /<w:r\b[^>]*>(?:(?!<w:r\b).)*?(<w:rPr>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:r>/.exec(bulletParaXml)?.[1] ?? "";

  console.log(
    `Formatting captured:\n  heading pPr: ${phPPR ? "yes (" + phPPR.length + " bytes)" : "(none - plain paragraph)"}\n` +
      `  heading rPr: ${phRPR ? "yes" : "(none)"}\n` +
      `  bullet pPr:  ${bulletPPR ? "yes (" + bulletPPR.length + " bytes)" : "(none!)"}\n` +
      `  bullet rPr:  ${bulletRPR ? "yes" : "(none)"}`,
  );

  // -- Build replacement paragraphs --
  function makeHeadingPara(projectName: string): string {
    return (
      `<w:p>${phPPR}<w:r>${phRPR}<w:t xml:space="preserve">${xmlEscape(projectName)}</w:t></w:r></w:p>`
    );
  }
  function makeBulletPara(text: string): string {
    return `<w:p>${bulletPPR}<w:r>${bulletRPR}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  }

  const newParas: string[] = [];
  for (const project of picks.projects) {
    if (typeof project.projectName !== "string" || project.projectName.trim() === "") {
      fail(`Invalid picks file: a project has an empty projectName.`);
    }
    if (!Array.isArray(project.bullets) || project.bullets.length === 0) {
      fail(`Invalid picks file: project "${project.projectName}" has no bullets.`);
    }
    newParas.push(makeHeadingPara(project.projectName));
    for (const b of project.bullets) {
      newParas.push(makeBulletPara(b));
    }
  }

  // -- Splice: replace ONLY the placeholder paragraph, byte-region exact --
  docXml =
    docXml.slice(0, phMatch.index ?? 0) + newParas.join("") + docXml.slice((phMatch.index ?? 0) + placeholderPara.length);

  writeFileSync(docXmlPath, Buffer.from(docXml, "utf8"));

  // -- Rezip preserving structure --
  // ROOT CAUSE HISTORY: this used to be PS 5.1 `Compress-Archive -Path $files.FullName`.
  // Two defects made that unusable for docx: (1) -Path arguments are treated as
  // WILDCARD patterns even when they are literal paths, so `[Content_Types].xml`
  // parses as a character-class glob matching nothing and is silently dropped;
  // (2) entry names came out with backslash separators, violating OPC/zip spec.
  // The replacement walks the filesystem recursively in Node (no pattern
  // matching anywhere), asserts the critical part is present, then creates each
  // zip entry explicitly with forward-slash names via .NET ZipArchive.
  const outName = `tailored-resume-${slugify(picks.jobRole)}.docx`;
  const outPath = resolve(OUTPUT_DIR, outName);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  if (existsSync(outPath)) rmSync(outPath, { force: true });

  const allFiles = readdirSync(expandDir, {
    recursive: true,
    withFileTypes: true,
  })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath ?? d.path, d.name));
  // Compare using paths RELATIVE to the unzip root - readdirSync(recursive)
  // returns joined paths, so a bare-filename equality check never matches.
  const allRel = allFiles.map((f) => relative(expandDir, f).replace(/\\/g, "/"));
  if (!allRel.includes("[Content_Types].xml")) {
    fail(
      "Unzipped tree is missing [Content_Types].xml - unzip step lost it. " +
        `Walked files: ${JSON.stringify(allRel)}`,
    );
  }
  const manifestPath = resolve(WORK_DIR, "file-manifest.txt");
  writeFileSync(
    manifestPath,
    Buffer.from(allFiles.map((f, i) => `${f}\t${allRel[i]}`).join("\n"), "utf8"),
  );
  console.log(`\nRezipping ${allFiles.length} walked files (glob-free, forward-slash entries)...`);

  const psScript =
    "Add-Type -AssemblyName System.IO.Compression; " +
    "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
    "$fs = [System.IO.File]::Open($env:DOCX_OUT, 'Create'); " +
    "$zip = New-Object System.IO.Compression.ZipArchive($fs, 'Create'); " +
    "Get-Content -LiteralPath $env:DOCX_MANIFEST | ForEach-Object { " +
    "$parts = $_ -split \"`t\"; " +
    "[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $parts[0], $parts[1]) | Out-Null }; " +
    "$zip.Dispose(); $fs.Dispose()";
  const rezip = spawnSync("powershell.exe", ["-NoProfile", "-Command", psScript], {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, DOCX_OUT: outPath, DOCX_MANIFEST: manifestPath },
  });
  if (rezip.status !== 0) {
    fail(`Failed to rezip docx (exit ${rezip.status}).`);
  }
  console.log(`\nWritten -> ${outPath}`);

  // -- Validate with scripts/validate.py --original template.docx --
  console.log("\nValidating structure vs original template...");
  const validator = spawnSync(
    "python",
    ["scripts/validate.py", "--original", TEMPLATE_PATH, outPath],
    { cwd: RESUME_DIR, stdio: "inherit", encoding: "utf8" },
  );
  cleanup();
  if (validator.status !== 0) {
    console.error(
      `\n[resume-tailor] VALIDATION FAILED (python exit ${validator.status}). ` +
        "Per protocol: STOPPING - no guessed fixes. Inspect the errors above.",
    );
    process.exit(2);
  }
  console.log(`\n[resume-tailor] DONE: ${outName} validated cleanly against the original template.`);
  console.log("Next: render to PDF/PNG via LibreOffice for visual verification:");
  console.log(`  soffice --headless --convert-to pdf --outdir output "${outPath}"`);
}

main();
