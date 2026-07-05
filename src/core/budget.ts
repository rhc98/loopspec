import type { Usage } from "../adapters/types.js";
import type { RunState } from "./state.js";
import type { Charter } from "../spec/types.js";

/** usage 의 비용을 누적. 구독 모드에서는 total_cost_usd 가 없어 0 누적. */
export function accountUsage(spent: number, usage?: Usage): number {
  return spent + (usage?.total_cost_usd ?? 0);
}

export function budgetExceeded(state: RunState, charter: Charter): boolean {
  const max = charter.budget.max_budget_usd;
  if (max === undefined) return false;
  return state.budgetSpentUsd > max;
}
