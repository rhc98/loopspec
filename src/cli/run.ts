import { execa } from "execa";
import { readFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import yaml from "js-yaml";
import { validateCharter } from "../spec/validator.js";
import type { Charter } from "../spec/types.js";
import { getAdapter, knownAgents, type Adapter } from "../adapters/registry.js";
import { appendEntry, readEntries } from "../core/run-log.js";
import { deriveState, type RunState, type Scorecard } from "../core/state.js";
import { pick, attemptGuard, stopCheck, buildScorecard } from "../core/controller.js";
import { applyOverrides, parseTokenBump, type RunOverrides } from "../core/overrides.js";
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
  maxIter?: number; // --max-iter: budget.max_iterations 오버라이드
  reportOnly?: boolean; // --report-only: 실행 계획만 출력, 아무것도 실행/기록 안 함
  filter?: string; // --filter: 콤마 구분 item id 목록 (정확 매칭)
  agent?: string; // --agent: 어댑터 레지스트리 키 (기본 claude-code)
  tokenBump?: string; // "+Nk" positional (예: +50k)
  adapter?: Adapter; // 테스트 심 — 레지스트리 조회를 우회해 어댑터 주입
}

function printScorecard(sc: Scorecard, logPath: string): void {
  console.log(`\n=== scorecard ===`);
  console.log(`  total:     ${sc.total}`);
  console.log(`  passed:    ${sc.passed}`);
  console.log(`  failed:    ${sc.failed}`);
  console.log(`  escalated: ${sc.escalated}`);
  console.log(`  iterations:${sc.iterations}`);
  console.log(`  spent_usd: $${sc.budgetSpentUsd}`);
  console.log(`  tokens:    ${sc.tokensSpent}`);
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

/** --report-only 출력: 무엇이 실행될지 보여주고 아무것도 실행/기록하지 않는다. */
function printReport(
  charter: Charter,
  effective: Charter,
  state: RunState,
  repoDir: string,
  findings: ReturnType<typeof scanCharter>,
): void {
  console.log(`\n=== loopspec report-only: ${charter.name} ===`);
  console.log(`Goal:  ${charter.goal}`);
  console.log(`Repo:  ${repoDir}`);
  const caps = [
    `iterations=${effective.budget.max_iterations}`,
    `tokens=${effective.budget.max_tokens ?? "(none)"}`,
    `usd=${effective.budget.max_budget_usd ?? "(none)"}`,
    `attempts/item=${effective.budget.max_attempts_per_item}`,
  ];
  console.log(`Caps:  ${caps.join("  ")}`);
  if (findings.length > 0) {
    console.log(`Scan:`);
    console.log(renderFindings(findings));
  }
  console.log(`Items:`);
  for (const item of effective.items) {
    const it = state.items.get(item.id);
    console.log(`  ${item.id}: ${it?.status ?? "pending"} (attempts ${it?.attempts ?? 0})`);
  }
  const next = pick(state, effective);
  console.log(`Next:  ${next?.id ?? "(none)"}`);
  const { stop, reason } = stopCheck(state, effective);
  if (stop) console.log(`Stop:  would stop immediately (${reason})`);
  console.log(`\n(report-only — nothing executed, nothing written)`);
}

export async function runCommand(charterPath: string, opts: RunOptions): Promise<number> {
  const { charter, raw } = loadAndValidate(charterPath);

  // 어댑터 해석 — 모르는 이름은 fail-closed
  const adapter = opts.adapter ?? getAdapter(opts.agent ?? "claude-code");
  if (!adapter) {
    console.error(`✗ unknown agent "${opts.agent}". Known agents: ${knownAgents().join(", ")}.`);
    return 1;
  }

  // 오버라이드 파싱 — fail-closed
  const overrides: RunOverrides = {};
  if (opts.tokenBump !== undefined) {
    const bump = parseTokenBump(opts.tokenBump);
    if (bump === null) {
      console.error(`✗ invalid token budget "${opts.tokenBump}" — expected +N or +Nk (e.g. +50k)`);
      return 1;
    }
    overrides.tokenBump = bump;
  }
  if (opts.maxIter !== undefined) {
    if (!Number.isInteger(opts.maxIter) || opts.maxIter <= 0) {
      console.error(`✗ invalid --max-iter "${opts.maxIter}" — expected a positive integer`);
      return 1;
    }
    overrides.maxIterations = opts.maxIter;
  }
  if (opts.filter !== undefined) {
    overrides.filterIds = opts.filter.split(",").map((s) => s.trim()).filter(Boolean);
  }

  const repoDir = resolve(opts.repo);
  const run_id = opts.resume ?? randomUUID();
  const logPath = resolve(runsDir(), `${charter.name}-${run_id}.jsonl`);

  // resume 면 기존 로그에서 prior state 파생 (+Nk 의 토큰 기준점으로도 사용)
  let prior: RunState | undefined;
  if (opts.resume) {
    const existing = readEntries(logPath);
    if (existing.length === 0) {
      console.error(`✗ no run-log to resume at ${logPath}`);
      return 1;
    }
    prior = deriveState(existing);
    // 모든 항목이 terminal 이면 더 할 일이 없다. budget/iteration stop 으로 completed 된
    // run 은 non-terminal 항목이 남아 있으므로 resume(+오버라이드 헤드룸) 가능.
    if (prior.status === "completed" && stopCheck(prior, charter).reason === "all-items-complete") {
      console.log(`run ${run_id.slice(0, 8)} already completed.`);
      const sc = buildScorecard(prior, charter);
      printScorecard(sc, logPath);
      return sc.escalated === 0 && sc.failed === 0 ? 0 : 1;
    }
  }

  const applied = applyOverrides(charter, overrides, prior?.tokensSpent ?? 0);
  if (applied.errors.length > 0) {
    console.error(`✗ invalid overrides:`);
    for (const e of applied.errors) console.error(`  ${e}`);
    return 1;
  }
  const effective = applied.charter;

  const findings = scanCharter(charter);

  // report-only — 게이트/preflight/로그 이전에 계획만 출력하고 종료 (install --report-only 선례)
  if (opts.reportOnly) {
    printReport(charter, effective, prior ?? deriveState([]), repoDir, findings);
    return 0;
  }

  // 신뢰 게이트 — 미동의 charter 의 danger 패턴은 preflight 전에 실행 거부(fail-closed).
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

  await adapter.preflight();

  console.log(`\n=== loopspec ${opts.resume ? "resume" : "run"}: ${charter.name} (${run_id.slice(0, 8)}) ===`);
  console.log(`Goal:  ${charter.goal}`);
  console.log(`Agent: ${adapter.name}`);
  console.log(`Repo:  ${repoDir}`);
  console.log(`Items: ${effective.items.map((i) => i.id).join(", ")}`);
  if (Object.keys(overrides).length > 0) {
    const parts: string[] = [];
    if (overrides.maxIterations !== undefined) parts.push(`max-iter=${overrides.maxIterations}`);
    if (overrides.tokenBump !== undefined) parts.push(`tokens=+${overrides.tokenBump} (cap ${effective.budget.max_tokens})`);
    if (overrides.filterIds !== undefined) parts.push(`filter=${overrides.filterIds.join(",")}`);
    console.log(`Overrides: ${parts.join("  ")}`);
  }
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
    const { stop, reason } = stopCheck(state, effective);
    if (stop) {
      console.log(`-- stop: ${reason}`);
      break;
    }

    const item = pick(state, effective);
    if (!item) break;

    if (!attemptGuard(state, effective, item.id)) {
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

    const prompt = buildStepPrompt(item, effective, state);
    const result = await adapter.runStep({
      prompt,
      allowedTools: ALLOWED_TOOLS,
      disallowedTools: effective.denylist ?? [],
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

    const outcome = result.isError ? "fail" : await runVerify(effective.verify?.commands ?? [], repoDir);
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

  const scorecard = buildScorecard(state, effective);
  appendEntry(logPath, run_id, { type: "run-completed", scorecard });
  printScorecard(scorecard, logPath);

  return scorecard.escalated === 0 && scorecard.failed === 0 ? 0 : 1;
}
