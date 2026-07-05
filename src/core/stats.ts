import type { RunLogEntry } from "./run-log.js";
import { deriveState } from "./state.js";

/** 한 run 의 집계 요약. */
export interface RunStats {
  run_id: string;
  charter: string;
  status: "running" | "completed";
  total: number;
  passed: number;
  failed: number;
  escalated: number;
  iterations: number;
  budgetSpentUsd: number;
  scopeViolations: number;
  denylistBlocks: number;
  /** completed && total > 0 && 모든 item pass. */
  converged: boolean;
}

/** 여러 run 에 걸친 한 item 의 누적 통계 (수렴 병목 식별용). */
export interface ItemStats {
  id: string;
  runs: number;
  passed: number;
  escalated: number;
  attempts: number;
}

/** cross-run 수렴 텔레메트리 집계. */
export interface AggregateStats {
  runs: number;
  completedRuns: number;
  convergedRuns: number;
  /** convergedRuns / completedRuns (완료 run 이 없으면 0). */
  convergenceRate: number;
  /** item 지표는 완료 run 만 대상 (terminal outcome 만 신뢰). */
  itemsTotal: number;
  itemsPassed: number;
  itemsEscalated: number;
  itemPassRate: number;
  /** 전체 run 대상. */
  avgIterationsPerRun: number;
  /** 완료 run 의 pass item 대상. */
  avgAttemptsPerPassedItem: number;
  scopeViolations: number;
  denylistBlocks: number;
  totalSpentUsd: number;
  /** 입력 순서 유지 (보통 오래된→최신). */
  perRun: RunStats[];
  /** worst-first 정렬 (escalation 많은 순). */
  perItem: ItemStats[];
}

/** 한 run-log 의 entries → RunStats. deriveState 로 outcome/iteration/cost 를 재사용하고
 * scope/denylist 이벤트와 charter 는 raw scan 으로 센다. */
export function computeRunStats(entries: RunLogEntry[]): RunStats {
  const state = deriveState(entries);
  let charter = "";
  let scopeViolations = 0;
  let denylistBlocks = 0;
  for (const { event } of entries) {
    if (event.type === "run-started") charter = event.charter;
    else if (event.type === "scope-violated") scopeViolations++;
    else if (event.type === "denylist-blocked") denylistBlocks++;
  }
  let passed = 0;
  let failed = 0;
  let escalated = 0;
  for (const it of state.items.values()) {
    if (it.status === "pass") passed++;
    else if (it.status === "fail") failed++;
    else if (it.status === "escalated") escalated++;
  }
  const total = state.items.size;
  return {
    run_id: state.run_id,
    charter,
    status: state.status,
    total,
    passed,
    failed,
    escalated,
    iterations: state.iterations,
    budgetSpentUsd: state.budgetSpentUsd,
    scopeViolations,
    denylistBlocks,
    converged: state.status === "completed" && total > 0 && passed === total,
  };
}

/** 여러 run-log (각각 entries 배열) → cross-run 집계. 순수함수, I/O 없음. */
export function computeStats(runs: RunLogEntry[][]): AggregateStats {
  const perRun: RunStats[] = [];
  const itemMap = new Map<string, ItemStats>();
  let passedAttempts = 0;
  let passedItems = 0;

  for (const entries of runs) {
    if (entries.length === 0) continue;
    const state = deriveState(entries);
    perRun.push(computeRunStats(entries));
    const completed = state.status === "completed";
    for (const it of state.items.values()) {
      const s = itemMap.get(it.id) ?? { id: it.id, runs: 0, passed: 0, escalated: 0, attempts: 0 };
      s.runs++;
      s.attempts += it.attempts;
      if (it.status === "pass") s.passed++;
      else if (it.status === "escalated") s.escalated++;
      itemMap.set(it.id, s);
      if (completed && it.status === "pass") {
        passedAttempts += it.attempts;
        passedItems++;
      }
    }
  }

  const completed = perRun.filter((r) => r.status === "completed");
  const convergedRuns = completed.filter((r) => r.converged).length;
  const itemsTotal = completed.reduce((a, r) => a + r.total, 0);
  const itemsPassed = completed.reduce((a, r) => a + r.passed, 0);
  const itemsEscalated = completed.reduce((a, r) => a + r.escalated, 0);
  const iterations = perRun.reduce((a, r) => a + r.iterations, 0);

  const perItem = [...itemMap.values()].sort(
    (a, b) =>
      b.escalated - a.escalated ||
      b.runs - b.passed - (a.runs - a.passed) ||
      a.id.localeCompare(b.id),
  );

  return {
    runs: perRun.length,
    completedRuns: completed.length,
    convergedRuns,
    convergenceRate: completed.length ? convergedRuns / completed.length : 0,
    itemsTotal,
    itemsPassed,
    itemsEscalated,
    itemPassRate: itemsTotal ? itemsPassed / itemsTotal : 0,
    avgIterationsPerRun: perRun.length ? iterations / perRun.length : 0,
    avgAttemptsPerPassedItem: passedItems ? passedAttempts / passedItems : 0,
    scopeViolations: perRun.reduce((a, r) => a + r.scopeViolations, 0),
    denylistBlocks: perRun.reduce((a, r) => a + r.denylistBlocks, 0),
    totalSpentUsd: perRun.reduce((a, r) => a + r.budgetSpentUsd, 0),
    perRun,
    perItem,
  };
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const usd = (n: number): string => `$${n.toFixed(2)}`;
const one = (n: number): string => n.toFixed(1);

/** AggregateStats → 사람이 읽는 텔레메트리 리포트 (순수함수, I/O 없음). */
export function renderStats(agg: AggregateStats, label?: string): string {
  if (agg.runs === 0) return "(no runs)";
  const lines: string[] = [];
  const scope = label ? `: ${label}` : "";
  lines.push(`loopspec stats${scope}   (${agg.runs} runs, ${agg.completedRuns} completed)`);
  lines.push("");
  lines.push(`convergence:  ${agg.convergedRuns}/${agg.completedRuns} completed converged  (${pct(agg.convergenceRate)})`);
  lines.push(`items:        ${agg.itemsPassed}/${agg.itemsTotal} passed  (${pct(agg.itemPassRate)})   ${agg.itemsEscalated} escalated`);
  lines.push(`efficiency:   ${one(agg.avgAttemptsPerPassedItem)} attempts / passed item   ${one(agg.avgIterationsPerRun)} iters / run`);
  lines.push(`safety:       ${agg.scopeViolations} scope violations   ${agg.denylistBlocks} denylist blocks`);
  lines.push(`cost:         ${usd(agg.totalSpentUsd)} total   ${usd(agg.runs ? agg.totalSpentUsd / agg.runs : 0)} / run`);

  lines.push("");
  lines.push("per-run:");
  lines.push(`  ${"run".padEnd(10)}${"status".padEnd(11)}${"items".padEnd(13)}${"iters".padEnd(7)}${"cost".padEnd(9)}conv`);
  for (const r of agg.perRun) {
    const items = `${r.passed}/${r.total} pass`;
    const mark = r.converged ? "✓" : r.status === "completed" ? "✗" : "…";
    lines.push(
      `  ${r.run_id.slice(0, 8).padEnd(10)}${r.status.padEnd(11)}${items.padEnd(13)}${String(r.iterations).padEnd(7)}${usd(r.budgetSpentUsd).padEnd(9)}${mark}`,
    );
  }

  lines.push("");
  lines.push("per-item (worst first):");
  lines.push(`  ${"item".padEnd(18)}${"runs".padEnd(6)}${"pass".padEnd(6)}${"esc".padEnd(5)}attempts`);
  for (const it of agg.perItem) {
    lines.push(`  ${it.id.padEnd(18)}${String(it.runs).padEnd(6)}${String(it.passed).padEnd(6)}${String(it.escalated).padEnd(5)}${it.attempts}`);
  }

  return lines.join("\n");
}
