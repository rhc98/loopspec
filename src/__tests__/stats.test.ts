import { describe, it, expect } from "vitest";
import type { RunLogEntry, RunLogEvent } from "../core/run-log.js";
import type { Usage } from "../adapters/types.js";
import { computeStats, computeRunStats, renderStats } from "../core/stats.js";

let seq = 0;
/** events → 한 run 의 RunLogEntry[]. */
function run(run_id: string, events: RunLogEvent[]): RunLogEntry[] {
  return events.map((event) => ({ schema_version: 1 as const, ts: `t${seq++}`, run_id, event }));
}

const cost = (usd: number): Usage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  total_cost_usd: usd,
});

// Run A — 완전 수렴: i1, i2 모두 1회에 pass.
const runA = run("aaaa1111-zzzz", [
  { type: "run-started", charter: "c.yaml", run_id: "aaaa1111-zzzz", items: ["i1", "i2"] },
  { type: "attempt-started", item_id: "i1", attempt: 1 },
  { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "pass", usage: cost(0.1) },
  { type: "attempt-started", item_id: "i2", attempt: 1 },
  { type: "attempt-completed", item_id: "i2", attempt: 1, outcome: "pass", usage: cost(0.05) },
  { type: "run-completed", scorecard: { total: 2, passed: 2, failed: 0, escalated: 0, budgetSpentUsd: 0.15, iterations: 2 } },
]);

// Run B — 부분 수렴: i1 은 2회만에 pass, i2 는 scope 위반 후 escalate.
const runB = run("bbbb2222-zzzz", [
  { type: "run-started", charter: "c.yaml", run_id: "bbbb2222-zzzz", items: ["i1", "i2"] },
  { type: "attempt-started", item_id: "i1", attempt: 1 },
  { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "fail", usage: cost(0.03) },
  { type: "attempt-started", item_id: "i1", attempt: 2 },
  { type: "attempt-completed", item_id: "i1", attempt: 2, outcome: "pass", usage: cost(0.03) },
  { type: "attempt-started", item_id: "i2", attempt: 1 },
  { type: "scope-violated", item_id: "i2", files: ["x.ts"] },
  { type: "attempt-completed", item_id: "i2", attempt: 1, outcome: "escalated" },
  { type: "item-escalated", item_id: "i2", reason: "scope" },
  { type: "run-completed", scorecard: { total: 2, passed: 1, failed: 0, escalated: 1, budgetSpentUsd: 0.06, iterations: 3 } },
]);

describe("computeRunStats", () => {
  it("marks a fully-passed completed run as converged", () => {
    const s = computeRunStats(runA);
    expect(s).toMatchObject({ total: 2, passed: 2, escalated: 0, iterations: 2, converged: true });
    expect(s.budgetSpentUsd).toBeCloseTo(0.15);
  });

  it("counts scope violations and does not converge on escalation", () => {
    const s = computeRunStats(runB);
    expect(s).toMatchObject({ passed: 1, escalated: 1, scopeViolations: 1, converged: false });
  });
});

describe("computeStats (cross-run)", () => {
  const agg = computeStats([runA, runB]);

  it("aggregates convergence and item pass rate over completed runs", () => {
    expect(agg.runs).toBe(2);
    expect(agg.completedRuns).toBe(2);
    expect(agg.convergedRuns).toBe(1);
    expect(agg.convergenceRate).toBeCloseTo(0.5);
    expect(agg.itemsTotal).toBe(4);
    expect(agg.itemsPassed).toBe(3);
    expect(agg.itemsEscalated).toBe(1);
    expect(agg.itemPassRate).toBeCloseTo(0.75);
  });

  it("averages iterations over all runs and attempts over passed items", () => {
    expect(agg.avgIterationsPerRun).toBeCloseTo(2.5); // (2 + 3) / 2
    expect(agg.avgAttemptsPerPassedItem).toBeCloseTo(4 / 3); // A.i1=1, A.i2=1, B.i1=2 over 3 items
    expect(agg.totalSpentUsd).toBeCloseTo(0.21);
    expect(agg.scopeViolations).toBe(1);
  });

  it("sorts per-item worst-first (most escalations)", () => {
    expect(agg.perItem.map((i) => i.id)).toEqual(["i2", "i1"]);
    expect(agg.perItem[0]).toMatchObject({ id: "i2", runs: 2, passed: 1, escalated: 1, attempts: 2 });
    expect(agg.perItem[1]).toMatchObject({ id: "i1", runs: 2, passed: 2, escalated: 0, attempts: 3 });
  });

  it("excludes still-running runs from the completed denominator", () => {
    const running = run("cccc3333-zzzz", [
      { type: "run-started", charter: "c.yaml", run_id: "cccc3333-zzzz", items: ["i1"] },
      { type: "attempt-started", item_id: "i1", attempt: 1 },
      { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "pass" },
    ]);
    const a = computeStats([runA, running]);
    expect(a.runs).toBe(2);
    expect(a.completedRuns).toBe(1);
    expect(a.convergenceRate).toBeCloseTo(1); // 1/1 completed
  });

  it("skips empty run-logs", () => {
    expect(computeStats([[], runA]).runs).toBe(1);
  });
});

describe("renderStats", () => {
  it("renders headline telemetry and per-item table", () => {
    const out = renderStats(computeStats([runA, runB]), "c");
    expect(out).toContain("loopspec stats: c");
    expect(out).toContain("2 runs, 2 completed");
    expect(out).toContain("converged  (50%)");
    expect(out).toContain("3/4 passed");
    expect(out).toContain("1 scope violations");
    expect(out).toContain("per-item");
  });

  it("reports no runs", () => {
    expect(renderStats(computeStats([]))).toBe("(no runs)");
  });
});
