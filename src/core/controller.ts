import type { Charter, Item } from "../spec/types.js";
import type { RunState, ItemStatus, Scorecard } from "./state.js";
import { budgetExceeded } from "./budget.js";

const TERMINAL: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["pass", "escalated"]);

function statusOf(state: RunState, itemId: string): ItemStatus {
  return state.items.get(itemId)?.status ?? "pending";
}

/** pending/in-progress/fail(=retryable) 중 charter 순서상 첫 아이템. 없으면 null. */
export function pick(state: RunState, charter: Charter): Item | null {
  for (const item of charter.items) {
    if (!TERMINAL.has(statusOf(state, item.id))) return item;
  }
  return null;
}

/** 남은 시도가 있는가. attempts < max_attempts_per_item. */
export function attemptGuard(state: RunState, charter: Charter, itemId: string): boolean {
  const attempts = state.items.get(itemId)?.attempts ?? 0;
  return attempts < charter.budget.max_attempts_per_item;
}

export function stopCheck(state: RunState, charter: Charter): { stop: boolean; reason?: string } {
  const allTerminal = charter.items.every((i) => TERMINAL.has(statusOf(state, i.id)));
  if (allTerminal) return { stop: true, reason: "all-items-complete" };
  if (budgetExceeded(state, charter)) return { stop: true, reason: "budget-exceeded" };
  if (state.iterations >= charter.budget.max_iterations) return { stop: true, reason: "max-iterations" };
  if (state.consecutiveFailures >= charter.budget.max_consecutive_failures) {
    return { stop: true, reason: "max-consecutive-failures" };
  }
  return { stop: false };
}

export function buildScorecard(state: RunState, charter: Charter): Scorecard {
  let passed = 0;
  let failed = 0;
  let escalated = 0;
  for (const item of charter.items) {
    const s = statusOf(state, item.id);
    if (s === "pass") passed += 1;
    else if (s === "fail") failed += 1;
    else if (s === "escalated") escalated += 1;
  }
  return {
    total: charter.items.length,
    passed,
    failed,
    escalated,
    budgetSpentUsd: state.budgetSpentUsd,
    tokensSpent: state.tokensSpent,
    iterations: state.iterations,
  };
}
