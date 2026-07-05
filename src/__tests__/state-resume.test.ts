import { describe, it, expect } from "vitest";
import { deriveState } from "../core/state.js";
import type { RunLogEntry, RunLogEvent } from "../core/run-log.js";

let seq = 0;
function log(events: RunLogEvent[]): RunLogEntry[] {
  return events.map((event) => ({ schema_version: 1 as const, ts: `t${seq++}`, run_id: "r", event }));
}

const started: RunLogEvent = { type: "run-started", charter: "c", run_id: "r", items: ["i1", "i2"] };

describe("deriveState resume semantics", () => {
  it("orphan attempt-started leaves item in-progress (non-terminal, resumable)", () => {
    const s = deriveState(log([started, { type: "attempt-started", item_id: "i1", attempt: 1 }]));
    const i1 = s.items.get("i1")!;
    expect(i1.status).toBe("in-progress");
    expect(i1.attempts).toBe(1);
    expect(s.status).toBe("running");
  });

  it("run-resumed and denylist-blocked are state no-ops", () => {
    const base = deriveState(log([started, { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "pass" }]));
    const after = deriveState(
      log([
        started,
        { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "pass" },
        { type: "run-resumed" },
        { type: "denylist-blocked", item_id: "i2", tools: ["Bash"] },
      ]),
    );
    expect(after.items.get("i1")!.status).toBe("pass");
    expect(after.iterations).toBe(base.iterations);
    expect(after.consecutiveFailures).toBe(base.consecutiveFailures);
    expect(after.status).toBe("running");
  });
});
