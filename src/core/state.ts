import type { RunLogEntry } from "./run-log.js";
import { accountUsage } from "./budget.js";

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
  iterations: number;
  consecutiveFailures: number;
}

export interface Scorecard {
  total: number;
  passed: number;
  failed: number;
  escalated: number;
  budgetSpentUsd: number;
  iterations: number;
}

/** run-log replay 로 RunState 재구성. 순수함수 (side-effect 없음). */
export function deriveState(entries: RunLogEntry[]): RunState {
  const state: RunState = {
    run_id: "",
    status: "running",
    items: new Map(),
    budgetSpentUsd: 0,
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
        const it = state.items.get(e.item_id);
        if (it) {
          it.status = "in-progress";
          it.attempts += 1;
        }
        break;
      }
      case "scope-violated": {
        // scope 위반은 실패 신호 — 연속 실패 카운터를 올린다. status 는 이어지는 item-escalated 가 확정.
        state.consecutiveFailures += 1;
        break;
      }
      case "attempt-completed": {
        const it = state.items.get(e.item_id);
        if (it) {
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
        }
        state.iterations += 1;
        state.budgetSpentUsd = accountUsage(state.budgetSpentUsd, e.usage);
        break;
      }
      case "item-escalated": {
        const it = state.items.get(e.item_id);
        if (it) {
          it.status = "escalated";
          it.lastOutcome = "escalated";
        }
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
