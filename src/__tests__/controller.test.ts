import { describe, it, expect } from "vitest";
import { deriveState } from "../core/state.js";
import type { RunLogEntry, RunLogEvent } from "../core/run-log.js";
import { pick, attemptGuard, stopCheck, buildScorecard } from "../core/controller.js";
import type { Charter } from "../spec/types.js";

const charter: Charter = {
  loopspec_version: "1.0",
  name: "t",
  readiness: "L1",
  goal: "g",
  scope: { include: ["src/a.ts", "src/b.ts"] },
  items: [
    { id: "i1", description: "d1", scope: { include: ["src/a.ts"] } },
    { id: "i2", description: "d2", scope: { include: ["src/b.ts"] } },
  ],
  budget: { max_iterations: 4, max_attempts_per_item: 2, max_consecutive_failures: 2 },
};

let seq = 0;
function log(events: RunLogEvent[]): RunLogEntry[] {
  return events.map((event) => ({ schema_version: 1 as const, ts: `t${seq++}`, run_id: "r", event }));
}

const started: RunLogEvent = { type: "run-started", charter: "c", run_id: "r", items: ["i1", "i2"] };

describe("pick", () => {
  it("returns first non-terminal item", () => {
    const s = deriveState(log([started]));
    expect(pick(s, charter)?.id).toBe("i1");
  });

  it("skips passed items", () => {
    const s = deriveState(
      log([started, { type: "attempt-started", item_id: "i1", attempt: 1 }, { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "pass" }]),
    );
    expect(pick(s, charter)?.id).toBe("i2");
  });

  it("returns null when all terminal", () => {
    const s = deriveState(
      log([
        started,
        { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "pass" },
        { type: "attempt-completed", item_id: "i2", attempt: 1, outcome: "pass" },
      ]),
    );
    expect(pick(s, charter)).toBeNull();
  });

  it("re-picks a failed (retryable) item", () => {
    const s = deriveState(
      log([started, { type: "attempt-started", item_id: "i1", attempt: 1 }, { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "fail" }]),
    );
    expect(pick(s, charter)?.id).toBe("i1");
  });
});

describe("attemptGuard", () => {
  it("true while attempts < max", () => {
    const s = deriveState(log([started, { type: "attempt-started", item_id: "i1", attempt: 1 }]));
    expect(attemptGuard(s, charter, "i1")).toBe(true);
  });

  it("false when attempts == max", () => {
    const s = deriveState(
      log([started, { type: "attempt-started", item_id: "i1", attempt: 1 }, { type: "attempt-started", item_id: "i1", attempt: 2 }]),
    );
    expect(attemptGuard(s, charter, "i1")).toBe(false);
  });
});

describe("stopCheck", () => {
  it("stops when all items terminal", () => {
    const s = deriveState(
      log([
        started,
        { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "pass" },
        { type: "item-escalated", item_id: "i2", reason: "x" },
      ]),
    );
    expect(stopCheck(s, charter)).toEqual({ stop: true, reason: "all-items-complete" });
  });

  it("stops on max-consecutive-failures", () => {
    const s = deriveState(
      log([
        started,
        { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "fail" },
        { type: "attempt-completed", item_id: "i2", attempt: 1, outcome: "fail" },
      ]),
    );
    expect(stopCheck(s, charter).reason).toBe("max-consecutive-failures");
  });

  it("stops on budget-exceeded", () => {
    const s = deriveState(
      log([started, { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "fail", usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, total_cost_usd: 5 } }]),
    );
    const budgeted: Charter = { ...charter, budget: { ...charter.budget, max_budget_usd: 1, max_consecutive_failures: 99 } };
    expect(stopCheck(s, budgeted).reason).toBe("budget-exceeded");
  });

  it("does not stop mid-run", () => {
    const s = deriveState(log([started]));
    expect(stopCheck(s, charter).stop).toBe(false);
  });
});

describe("buildScorecard", () => {
  it("counts passed/escalated and iterations", () => {
    const s = deriveState(
      log([
        started,
        { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "pass" },
        { type: "item-escalated", item_id: "i2", reason: "x" },
      ]),
    );
    const sc = buildScorecard(s, charter);
    expect(sc).toMatchObject({ total: 2, passed: 1, escalated: 1, failed: 0, iterations: 1 });
  });
});
