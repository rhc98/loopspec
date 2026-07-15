import { describe, it, expect } from "vitest";
import { validateCharter } from "../spec/validator.js";

const valid = {
  loopspec_version: "1.0",
  name: "t",
  readiness: "L1",
  goal: "g",
  scope: { include: ["src/a.ts"] },
  items: [{ id: "i1", description: "d", scope: { include: ["src/a.ts"] } }],
  budget: { max_iterations: 4, max_attempts_per_item: 2, max_consecutive_failures: 2 },
  verify: { commands: [] },
};

describe("validateCharter", () => {
  it("returns [] for a valid charter", () => {
    expect(validateCharter(valid)).toEqual([]);
  });

  it("rule 1: missing loopspec_version -> error", () => {
    const { loopspec_version, ...rest } = valid;
    const errs = validateCharter(rest);
    expect(errs.some((e) => e.rule === "loopspec_version")).toBe(true);
  });

  it("rule 2: budget without max_budget_usd or max_iterations -> error", () => {
    const bad = { ...valid, budget: { max_attempts_per_item: 2, max_consecutive_failures: 2 } };
    const errs = validateCharter(bad);
    expect(errs.some((e) => e.rule === "budget")).toBe(true);
  });

  it("rule 2: max_budget_usd alone satisfies budget", () => {
    const ok = { ...valid, budget: { max_budget_usd: 1, max_attempts_per_item: 2, max_consecutive_failures: 2 } };
    expect(validateCharter(ok).some((e) => e.rule === "budget")).toBe(false);
  });

  it("rule 2b: non-numeric max_tokens -> error", () => {
    const bad = { ...valid, budget: { ...valid.budget, max_tokens: "lots" } };
    expect(validateCharter(bad).some((e) => e.rule === "budget")).toBe(true);
  });

  it("rule 2b: non-positive max_tokens -> error", () => {
    const bad = { ...valid, budget: { ...valid.budget, max_tokens: 0 } };
    expect(validateCharter(bad).some((e) => e.rule === "budget")).toBe(true);
  });

  it("rule 2b: positive max_tokens is accepted; omitting it stays valid", () => {
    const ok = { ...valid, budget: { ...valid.budget, max_tokens: 50000 } };
    expect(validateCharter(ok)).toEqual([]);
    expect(validateCharter(valid)).toEqual([]);
  });

  it("rule 3: L2 with empty verify.commands -> error", () => {
    const bad = { ...valid, readiness: "L2", verify: { commands: [] } };
    const errs = validateCharter(bad);
    expect(errs.some((e) => e.rule === "verify")).toBe(true);
  });

  it("rule 3: L2 with non-empty verify.commands -> ok", () => {
    const ok = { ...valid, readiness: "L2", verify: { commands: ["tsc --noEmit"] } };
    expect(validateCharter(ok).some((e) => e.rule === "verify")).toBe(false);
  });

  it("rule 4: item missing scope.include -> error", () => {
    const bad = { ...valid, items: [{ id: "i1", description: "d", scope: { include: [] } }] };
    const errs = validateCharter(bad);
    expect(errs.some((e) => e.rule === "items")).toBe(true);
  });

  it("non-object input -> shape error", () => {
    expect(validateCharter(null).some((e) => e.rule === "shape")).toBe(true);
  });
});
