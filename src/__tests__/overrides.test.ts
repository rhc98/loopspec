import { describe, it, expect } from "vitest";
import { parseTokenBump, applyOverrides } from "../core/overrides.js";
import { accountTokens } from "../core/budget.js";
import { deriveState } from "../core/state.js";
import { stopCheck, buildScorecard } from "../core/controller.js";
import type { RunLogEntry, RunLogEvent } from "../core/run-log.js";
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

function usage(input: number, output: number, cacheRead = 0) {
  return { input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: cacheRead };
}

describe("parseTokenBump", () => {
  it("parses +Nk and +N", () => {
    expect(parseTokenBump("+50k")).toBe(50000);
    expect(parseTokenBump("+50K")).toBe(50000);
    expect(parseTokenBump("+500")).toBe(500);
  });

  it("rejects malformed values (fail-closed)", () => {
    expect(parseTokenBump("50k")).toBeNull();
    expect(parseTokenBump("+")).toBeNull();
    expect(parseTokenBump("+3.5k")).toBeNull();
    expect(parseTokenBump("-50k")).toBeNull();
    expect(parseTokenBump("+0")).toBeNull();
  });
});

const FRESH = { tokens: 0, iterations: 0 };

describe("applyOverrides", () => {
  it("maxIterations is additive headroom: fresh run cap = N", () => {
    const { charter: eff, errors } = applyOverrides(charter, { maxIterations: 1 }, FRESH);
    expect(errors).toEqual([]);
    expect(eff.budget.max_iterations).toBe(1);
    expect(charter.budget.max_iterations).toBe(4); // 원본 불변
  });

  it("maxIterations on resume adds headroom above iterations already run", () => {
    const { charter: eff } = applyOverrides(charter, { maxIterations: 3 }, { tokens: 0, iterations: 5 });
    expect(eff.budget.max_iterations).toBe(8);
  });

  it("non-positive or non-integer maxIterations fails closed via errors", () => {
    expect(applyOverrides(charter, { maxIterations: 0 }, FRESH).errors.length).toBe(1);
    expect(applyOverrides(charter, { maxIterations: 1.5 }, FRESH).errors.length).toBe(1);
    expect(applyOverrides(charter, { maxIterations: NaN }, FRESH).errors.length).toBe(1);
  });

  it("tokenBump on a fresh run sets cap = N", () => {
    const { charter: eff } = applyOverrides(charter, { tokenBump: "+50k" }, FRESH);
    expect(eff.budget.max_tokens).toBe(50000);
  });

  it("tokenBump on resume adds headroom above tokens already spent", () => {
    const { charter: eff } = applyOverrides(charter, { tokenBump: "+50k" }, { tokens: 60000, iterations: 0 });
    expect(eff.budget.max_tokens).toBe(110000);
  });

  it("tokenBump overrides a charter-declared max_tokens", () => {
    const declared: Charter = { ...charter, budget: { ...charter.budget, max_tokens: 10 } };
    const { charter: eff } = applyOverrides(declared, { tokenBump: "+500" }, FRESH);
    expect(eff.budget.max_tokens).toBe(500);
  });

  it("malformed tokenBump fails closed via errors", () => {
    const { errors } = applyOverrides(charter, { tokenBump: "50k" }, FRESH);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('"50k"');
  });

  it("filter keeps charter order and only matching items", () => {
    const { charter: eff, errors } = applyOverrides(charter, { filterIds: ["i2"] }, FRESH);
    expect(errors).toEqual([]);
    expect(eff.items.map((i) => i.id)).toEqual(["i2"]);
    expect(charter.items.length).toBe(2); // 원본 불변
  });

  it("filter with unknown id fails closed, listing known ids", () => {
    const { errors } = applyOverrides(charter, { filterIds: ["nope"] }, FRESH);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('"nope"');
    expect(errors[0]).toContain("i1, i2");
  });

  it("no overrides -> charter unchanged", () => {
    const { charter: eff, errors } = applyOverrides(charter, {}, FRESH);
    expect(errors).toEqual([]);
    expect(eff.budget).toEqual(charter.budget);
    expect(eff.items).toEqual(charter.items);
  });
});

describe("token accounting", () => {
  it("accountTokens sums input+output and ignores cache tokens", () => {
    expect(accountTokens(0, usage(100, 50, 99999))).toBe(150);
    expect(accountTokens(10, undefined)).toBe(10);
  });

  it("deriveState accumulates tokensSpent across attempts", () => {
    const s = deriveState(
      log([
        started,
        { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "pass", usage: usage(1000, 500) },
        { type: "attempt-completed", item_id: "i2", attempt: 1, outcome: "fail", usage: usage(2000, 500) },
      ]),
    );
    expect(s.tokensSpent).toBe(4000);
  });

  it("legacy entries without usage replay to tokensSpent 0 (backward compat)", () => {
    const s = deriveState(log([started, { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "pass" }]));
    expect(s.tokensSpent).toBe(0);
  });

  it("stopCheck trips budget-exceeded past max_tokens", () => {
    const s = deriveState(
      log([started, { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "pass", usage: usage(40000, 20000) }]),
    );
    const capped: Charter = { ...charter, budget: { ...charter.budget, max_tokens: 50000 } };
    expect(stopCheck(s, capped)).toEqual({ stop: true, reason: "budget-exceeded" });
    expect(stopCheck(s, charter).stop).toBe(false); // 캡 없으면 토큰으로는 안 멈춤
  });

  it("buildScorecard carries tokensSpent", () => {
    const s = deriveState(
      log([started, { type: "attempt-completed", item_id: "i1", attempt: 1, outcome: "pass", usage: usage(1000, 200) }]),
    );
    expect(buildScorecard(s, charter).tokensSpent).toBe(1200);
  });
});
