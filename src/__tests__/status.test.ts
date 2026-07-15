import { describe, it, expect } from "vitest";
import type { RunLogEntry, RunLogEvent } from "../core/run-log.js";
import { renderStatus } from "../core/status.js";

let seq = 0;
function log(events: RunLogEvent[]): RunLogEntry[] {
  return events.map((event) => ({ schema_version: 1 as const, ts: `t${seq++}`, run_id: "abc12345-zzzz", event }));
}

const started: RunLogEvent = { type: "run-started", charter: "c", run_id: "abc12345-zzzz", items: ["i1", "i2"] };

describe("renderStatus", () => {
  it("reports an empty log", () => {
    expect(renderStatus([])).toContain("empty");
  });

  it("renders item rows and a summary line", () => {
    const out = renderStatus(
      log([
        started,
        { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "pass" },
        { type: "item-escalated", item_id: "i2", reason: "x" },
        { type: "run-completed", scorecard: { total: 2, passed: 1, failed: 0, escalated: 1, budgetSpentUsd: 0, tokensSpent: 0, iterations: 1 } },
      ]),
    );
    expect(out).toContain("i1");
    expect(out).toContain("i2");
    expect(out).toContain("pass=1");
    expect(out).toContain("escalated=1");
    expect(out).toContain("status: completed");
  });
});
