import type { RunLogEntry } from "./run-log.js";
import { accountUsage, accountTokens } from "./budget.js";

export type ItemStatus = "pending" | "in-progress" | "pass" | "fail" | "escalated";

export interface ItemState {
  id: string;
  status: ItemStatus;
  attempts: number;
  lastOutcome?: "pass" | "fail" | "escalated";
}

export interface RunState {
  run_id: string;
  status: "running" | "completed";
  items: Map<string, ItemState>;
  budgetSpentUsd: number;
  tokensSpent: number;
  iterations: number;
  consecutiveFailures: number;
}

export interface Scorecard {
  total: number;
  passed: number;
  failed: number;
  escalated: number;
  budgetSpentUsd: number;
  tokensSpent: number;
  iterations: number;
}

/** 로그에 늦게 등장하는 item 도 추적 — 필터된 run 을 나중에 넓은 필터로 resume 하면
 * run-started 에 없던 id 의 attempt 이벤트가 나올 수 있다. */
function itemOf(state: RunState, id: string): ItemState {
  let it = state.items.get(id);
  if (!it) {
    it = { id, status: "pending", attempts: 0 };
    state.items.set(id, it);
  }
  return it;
}

/** run-log replay 로 RunState 재구성. 순수함수 (side-effect 없음). */
export function deriveState(entries: RunLogEntry[]): RunState {
  const state: RunState = {
    run_id: "",
    status: "running",
    items: new Map(),
    budgetSpentUsd: 0,
    tokensSpent: 0,
    iterations: 0,
    consecutiveFailures: 0,
  };

  for (const entry of entries) {
    const e = entry.event;
    if (state.run_id === "") state.run_id = entry.run_id;

    switch (e.type) {
      case "run-started": {
        state.run_id = e.run_id;
        for (const id of e.items) {
          state.items.set(id, { id, status: "pending", attempts: 0 });
        }
        break;
      }
      case "attempt-started": {
        const it = itemOf(state, e.item_id);
        it.status = "in-progress";
        it.attempts += 1;
        break;
      }
      case "scope-violated": {
        // scope 위반은 실패 신호 — 연속 실패 카운터를 올린다. status 는 이어지는 item-escalated 가 확정.
        state.consecutiveFailures += 1;
        break;
      }
      case "attempt-completed": {
        const it = itemOf(state, e.item_id);
        it.lastOutcome = e.outcome;
        if (e.outcome === "pass") {
          it.status = "pass";
          state.consecutiveFailures = 0;
        } else if (e.outcome === "fail") {
          it.status = "fail";
          state.consecutiveFailures += 1;
        } else {
          it.status = "escalated";
        }
        state.iterations += 1;
        state.budgetSpentUsd = accountUsage(state.budgetSpentUsd, e.usage);
        state.tokensSpent = accountTokens(state.tokensSpent, e.usage);
        break;
      }
      case "run-resumed": {
        // 재개된 run 은 다시 running — budget/iteration stop 으로 completed 된 run 도
        // 캡을 올려(resume + 오버라이드) 이어갈 수 있다. resume 은 운영자 개입이므로
        // 연속 실패 스트릭도 단절된다 (아니면 max-consecutive-failures 로 멈춘 run 이
        // 영원히 재개 불가).
        state.status = "running";
        state.consecutiveFailures = 0;
        break;
      }
      case "item-escalated": {
        const it = itemOf(state, e.item_id);
        it.status = "escalated";
        it.lastOutcome = "escalated";
        break;
      }
      case "run-completed": {
        state.status = "completed";
        break;
      }
    }
  }

  return state;
}
