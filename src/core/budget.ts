import type { Usage } from "../adapters/types.js";
import type { RunState } from "./state.js";
import type { Charter } from "../spec/types.js";

/** usage 의 비용을 누적. 구독 모드에서는 total_cost_usd 가 없어 0 누적. */
export function accountUsage(spent: number, usage?: Usage): number {
  return spent + (usage?.total_cost_usd ?? 0);
}

/** input+output 토큰 누적. cache 토큰은 캐시 역학이지 작업량이 아니므로 제외. */
export function accountTokens(spent: number, usage?: Usage): number {
  return spent + (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
}

export function budgetExceeded(state: RunState, charter: Charter): boolean {
  const maxUsd = charter.budget.max_budget_usd;
  if (maxUsd !== undefined && state.budgetSpentUsd > maxUsd) return true;
  const maxTokens = charter.budget.max_tokens;
  if (maxTokens !== undefined && state.tokensSpent > maxTokens) return true;
  return false;
}
