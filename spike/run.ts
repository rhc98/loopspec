import { execa } from "execa";
import { readFileSync, appendFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIXTURE_REPO = join(ROOT, "fixtures", "mini-repo");
const CHARTER_PATH = join(ROOT, "fixtures", "mini-charter.yaml");
const RESULTS_PATH = join(ROOT, "spike", "results.jsonl");

interface Charter {
  name: string;
  goal: string;
  scope: { include: string[] };
  budget: {
    default_tokens: number;
    est_tokens_per_iteration: number;
    max_iterations: number;
    max_attempts_per_item: number;
    max_consecutive_failures: number;
  };
}

const charter = yaml.load(readFileSync(CHARTER_PATH, "utf8")) as Charter;

const runNumber = existsSync(RESULTS_PATH)
  ? readFileSync(RESULTS_PATH, "utf8").trim().split("\n").filter(Boolean).length + 1
  : 1;

console.log(`\n=== loopspec Ship 0 Spike — Run ${runNumber} ===`);
console.log(`Goal: ${charter.goal}`);
console.log(`Scope: ${charter.scope.include.join(", ")}`);

// [1] Reset fixture repo
console.log("\n[1/4] Resetting fixture repo...");
await execa("git", ["checkout", "HEAD", "--", "."], { cwd: FIXTURE_REPO });

// Verify the type error is present before we start
const beforeDiff = await execa("git", ["diff", "--name-only", "HEAD"], { cwd: FIXTURE_REPO });
console.log(`  Clean state confirmed (changed files: [${beforeDiff.stdout.trim() || "none"}])`);

// [2] Build prompt — scope-locked, no-verify instruction
const scopeFile = charter.scope.include[0];
const prompt = [
  `Task: ${charter.goal}`,
  ``,
  `CONSTRAINTS (strictly enforced):`,
  `- Edit ONLY this file: ${scopeFile}`,
  `- Do NOT run any shell commands, tests, or build tools`,
  `- Do NOT edit any other files`,
  `- Make the minimal change to fix the issue and stop`,
  `- Return immediately after editing`,
].join("\n");

console.log("\n[2/4] Spawning claude -p ...");

// [3] Run claude with allowedTools whitelist (mechanically prevents Bash)
let rawOutput = "";
let spawnError: string | null = null;

try {
  const result = await execa(
    "claude",
    [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--allowedTools",
      "Read,Edit",
      "--max-turns",
      "5",
    ],
    {
      cwd: FIXTURE_REPO,
      reject: false,
      timeout: 120_000,
    },
  );
  rawOutput = result.stdout ?? "";
  if (result.stderr) console.log(`  stderr: ${result.stderr.slice(0, 200)}`);
} catch (err: unknown) {
  const e = err as { stdout?: string; stderr?: string; message?: string };
  rawOutput = e.stdout ?? "";
  spawnError = e.message ?? "unknown spawn error";
  console.log(`  Spawn error: ${spawnError}`);
}

// [4] Parse stream-json — is_error authoritative (subtype unreliable: preflight confirmed)
console.log("\n[3/4] Parsing stream-json...");
const lines = rawOutput.split("\n").filter(Boolean);
const toolCalls: string[] = [];
let bashCalls = 0;
let totalCostUsd: number | null = null;
let usage: Record<string, number> = {};
let isError = false;
let resultText = "";

const BASH_TOOL_NAMES = new Set(["Bash", "bash", "computer", "run_command", "execute_command"]);

for (const line of lines) {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    continue;
  }

  if (event["is_error"] === true) isError = true;

  // Tool uses embedded in assistant message content blocks
  const msg = event["message"] as { content?: Array<{ type: string; name?: string }> } | undefined;
  if (event["type"] === "assistant" && msg?.content) {
    for (const block of msg.content) {
      if (block.type === "tool_use" && block.name) {
        toolCalls.push(block.name);
        if (BASH_TOOL_NAMES.has(block.name)) {
          bashCalls++;
          console.log(`  !! Bash/run tool call detected: ${block.name}`);
        }
      }
    }
  }

  if (event["type"] === "result") {
    if (event["is_error"]) isError = true;
    totalCostUsd = (event["total_cost_usd"] as number) ?? null;
    usage = (event["usage"] as Record<string, number>) ?? {};
    const r = event["result"];
    resultText = typeof r === "string" ? r : JSON.stringify(r);
  }
}

console.log(`  Tool calls: [${toolCalls.join(", ")}]`);
console.log(`  Bash calls: ${bashCalls}`);
console.log(`  Cost: $${totalCostUsd ?? "unknown (subscription mode)"}`);
console.log(`  Usage: ${JSON.stringify(usage)}`);
if (isError) console.log(`  is_error: true`);

// [4] Scope containment check
console.log("\n[4/4] Checking scope containment...");
const diffResult = await execa("git", ["diff", "--name-only", "HEAD"], { cwd: FIXTURE_REPO });
const changedFiles = diffResult.stdout.trim().split("\n").filter(Boolean);
console.log(`  Changed files: [${changedFiles.join(", ")}]`);

const allowedFiles = new Set(charter.scope.include);
const scopeViolations = changedFiles.filter((f) => !allowedFiles.has(f));
if (scopeViolations.length > 0) {
  console.log(`  !! Scope violations: [${scopeViolations.join(", ")}]`);
} else {
  console.log(`  Scope clean.`);
}

// Record
const record = {
  run: runNumber,
  ts: new Date().toISOString(),
  charter: charter.name,
  scope_violations: scopeViolations,
  tool_calls: toolCalls,
  bash_calls: bashCalls,
  cost_usd: totalCostUsd,
  tokens: usage,
  changed_files: changedFiles,
  is_error: isError,
  spawn_error: spawnError,
  result_preview: resultText.slice(0, 300),
};

appendFileSync(RESULTS_PATH, JSON.stringify(record) + "\n");
console.log(`\nResult written to spike/results.jsonl (run ${runNumber})`);

// Kill criteria evaluation
console.log("\n=== KILL CRITERIA ===");
const passA = scopeViolations.length === 0;
const passB = bashCalls === 0;
const outputTokens = (usage["output_tokens"] as number) ?? 0;
const OUTPUT_TOKEN_LIMIT = 500;
const passC = outputTokens < OUTPUT_TOKEN_LIMIT;

console.log(
  `(a) Scope containment : ${passA ? "✓ PASS" : "✗ FAIL"} (violations: ${scopeViolations.length})`,
);
console.log(
  `(b) Self-verify suppressed: ${passB ? "✓ PASS" : "✗ FAIL"} (bash calls: ${bashCalls})`,
);
console.log(
  `(c) Task output size  : ${passC ? "✓ PASS" : "✗ FAIL"} (output_tokens: ${outputTokens}, limit: ${OUTPUT_TOKEN_LIMIT})`,
);

const hardFail = !passA || !passB || !passC;
if (hardFail) {
  console.log("\n⚠  KILL criterion triggered — see spike/FINDINGS.md before proceeding.");
  process.exit(1);
} else {
  const runsTotal = runNumber;
  if (runsTotal >= 3) {
    console.log(`\n✓ All criteria passed across ${runsTotal} runs. Ship 1 is unblocked.`);
  } else {
    console.log(
      `\n✓ Run ${runsTotal}/3 passed. Re-run ${3 - runsTotal} more time(s) to confirm.`,
    );
  }
}
