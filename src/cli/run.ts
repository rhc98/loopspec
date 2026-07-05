import { execa } from "execa";
import { readFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import yaml from "js-yaml";
import { validateCharter } from "../spec/validator.js";
import type { Charter } from "../spec/types.js";
import { preflight, runStep } from "../adapters/claude-code.js";
import { appendEntry, readEntries } from "../core/run-log.js";
import { deriveState, type Scorecard } from "../core/state.js";
import { pick, attemptGuard, stopCheck, buildScorecard } from "../core/controller.js";
import { buildStepPrompt } from "../core/prompt.js";
import { stepChangedFiles, scopeViolations } from "../core/scope.js";
import { scanCharter, hasDanger, renderFindings } from "../core/scan.js";
import { charterChecksum, isConsented } from "./trust-ledger.js";

const ALLOWED_TOOLS = ["Read", "Edit"];
const MAX_TURNS = 5;

interface RunOptions {
  repo: string;
  resume?: string; // run_id of an existing run-log to continue
  yes?: boolean; // trust-gate override for DANGER findings
}

function printScorecard(sc: Scorecard, logPath: string): void {
  console.log(`\n=== scorecard ===`);
  console.log(`  total:     ${sc.total}`);
  console.log(`  passed:    ${sc.passed}`);
  console.log(`  failed:    ${sc.failed}`);
  console.log(`  escalated: ${sc.escalated}`);
  console.log(`  iterations:${sc.iterations}`);
  console.log(`  spent_usd: $${sc.budgetSpentUsd}`);
  console.log(`  log:       ${logPath}\n`);
}

function runsDir(): string {
  return resolve(process.cwd(), ".loopspec", "runs");
}

async function gitDiffNames(repoDir: string): Promise<string[]> {
  const r = await execa("git", ["diff", "--name-only", "HEAD"], { cwd: repoDir, reject: false });
  return r.stdout.trim().split("\n").filter(Boolean);
}

/** 지정한 파일들만 HEAD 로 되돌림 (이전 통과 아이템 변경분은 보존). */
async function gitCheckoutFiles(repoDir: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  await execa("git", ["checkout", "HEAD", "--", ...files], { cwd: repoDir, reject: false });
}

/** verify 커맨드 실행. 비어 있으면(L1) vacuously pass. 하나라도 실패하면 fail. */
async function runVerify(commands: string[], repoDir: string): Promise<"pass" | "fail"> {
  for (const cmd of commands) {
    const r = await execa(cmd, { cwd: repoDir, reject: false, shell: true });
    if (r.exitCode !== 0) return "fail";
  }
  return "pass";
}

function loadAndValidate(charterPath: string): { charter: Charter; raw: string } {
  const text = readFileSync(charterPath, "utf8");
  const parsed = yaml.load(text);
  const errors = validateCharter(parsed);
  if (errors.length > 0) {
    console.error(`✗ ${charterPath} is invalid:`);
    for (const e of errors) console.error(`  [${e.rule}] ${e.message}`);
    process.exit(1);
  }
  return { charter: parsed as Charter, raw: text };
}

export async function runCommand(charterPath: string, opts: RunOptions): Promise<number> {
  const { charter, raw } = loadAndValidate(charterPath);

  // 신뢰 게이트 — 미동의 charter 의 danger 패턴은 preflight 전에 실행 거부(fail-closed).
  const findings = scanCharter(charter);
  if (hasDanger(findings)) {
    const trusted = isConsented(process.cwd(), charterChecksum(raw));
    if (!trusted && !opts.yes) {
      console.error(`✗ refused to run "${charter.name}": untrusted charter with DANGER-level findings.`);
      console.error(renderFindings(findings));
      console.error(`\nInstall it with consent (loopspec install …) or re-run with --yes to override.`);
      return 1;
    }
    console.log(`⚠ running charter with DANGER-level findings (${trusted ? "consented" : "--yes override"}).`);
  } else if (findings.length > 0) {
    console.log(`⚠ scan warnings:`);
    console.log(renderFindings(findings));
  }

  await preflight();
  const repoDir = resolve(opts.repo);

  const run_id = opts.resume ?? randomUUID();
  const logPath = resolve(runsDir(), `${charter.name}-${run_id}.jsonl`);

  if (opts.resume) {
    const existing = readEntries(logPath);
    if (existing.length === 0) {
      console.error(`✗ no run-log to resume at ${logPath}`);
      return 1;
    }
    const prior = deriveState(existing);
    if (prior.status === "completed") {
      console.log(`run ${run_id.slice(0, 8)} already completed.`);
      const sc = buildScorecard(prior, charter);
      printScorecard(sc, logPath);
      return sc.escalated === 0 && sc.failed === 0 ? 0 : 1;
    }
  }

  console.log(`\n=== loopspec ${opts.resume ? "resume" : "run"}: ${charter.name} (${run_id.slice(0, 8)}) ===`);
  console.log(`Goal:  ${charter.goal}`);
  console.log(`Repo:  ${repoDir}`);
  console.log(`Items: ${charter.items.map((i) => i.id).join(", ")}`);
  console.log(`Log:   ${logPath}\n`);

  if (opts.resume) {
    appendEntry(logPath, run_id, { type: "run-resumed" });
  } else {
    appendEntry(logPath, run_id, {
      type: "run-started",
      charter: charterPath,
      run_id,
      items: charter.items.map((i) => i.id),
    });
  }
  let state = deriveState(readEntries(logPath));

  while (true) {
    const { stop, reason } = stopCheck(state, charter);
    if (stop) {
      console.log(`-- stop: ${reason}`);
      break;
    }

    const item = pick(state, charter);
    if (!item) break;

    if (!attemptGuard(state, charter, item.id)) {
      console.log(`[${item.id}] max_attempts reached -> escalate`);
      appendEntry(logPath, run_id, { type: "item-escalated", item_id: item.id, reason: "max_attempts" });
      state = deriveState(readEntries(logPath));
      continue;
    }

    const attempt = (state.items.get(item.id)?.attempts ?? 0) + 1;
    console.log(`[${item.id}] attempt ${attempt} ...`);
    appendEntry(logPath, run_id, { type: "attempt-started", item_id: item.id, attempt });

    // step 시작 시점의 dirty 파일(이전 통과 아이템 변경분)을 baseline 으로 기록
    const before = await gitDiffNames(repoDir);

    const prompt = buildStepPrompt(item, charter, state);
    const result = await runStep({
      prompt,
      allowedTools: ALLOWED_TOOLS,
      disallowedTools: charter.denylist ?? [],
      maxTurns: MAX_TURNS,
      cwd: repoDir,
    });

    // denylist 감사 — 어댑터가 차단한 도구 호출을 run-log 에 기록
    if (result.permissionDenials && result.permissionDenials.length > 0) {
      console.log(`[${item.id}] denylist blocked: ${result.permissionDenials.join(", ")}`);
      appendEntry(logPath, run_id, { type: "denylist-blocked", item_id: item.id, tools: result.permissionDenials });
    }

    // scope assert — 이번 step 이 새로 건드린 파일만 item.scope.include 와 대조
    const after = await gitDiffNames(repoDir);
    const violations = scopeViolations(before, after, item.scope.include);
    if (violations.length > 0) {
      console.log(`[${item.id}] scope violation: ${violations.join(", ")} -> rollback + escalate`);
      appendEntry(logPath, run_id, { type: "scope-violated", item_id: item.id, files: violations });
      // 이번 step 변경분만 되돌림 (앞서 통과한 아이템 변경분은 보존)
      await gitCheckoutFiles(repoDir, stepChangedFiles(before, after));
      appendEntry(logPath, run_id, { type: "item-escalated", item_id: item.id, reason: "scope-violation" });
      state = deriveState(readEntries(logPath));
      continue;
    }

    const outcome = result.isError ? "fail" : await runVerify(charter.verify?.commands ?? [], repoDir);
    console.log(`[${item.id}] tools=[${result.toolCalls.join(",")}] outcome=${outcome}`);
    appendEntry(logPath, run_id, {
      type: "attempt-completed",
      item_id: item.id,
      attempt,
      outcome,
      usage: result.usage,
    });
    state = deriveState(readEntries(logPath));
  }

  const scorecard = buildScorecard(state, charter);
  appendEntry(logPath, run_id, { type: "run-completed", scorecard });
  printScorecard(scorecard, logPath);

  return scorecard.escalated === 0 && scorecard.failed === 0 ? 0 : 1;
}
