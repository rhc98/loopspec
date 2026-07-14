import type { RunLogEntry } from "./run-log.js";
import { deriveState, type ItemState } from "./state.js";

/** item 한 개의 상태 줄 — status 명령과 run --report-only 가 공유하는 포맷. */
export function renderItemLine(it: ItemState): string {
  const last = it.lastOutcome ? ` last=${it.lastOutcome}` : "";
  return `  ${it.id.padEnd(16)} ${it.status.padEnd(12)} attempts=${it.attempts}${last}`;
}

/** run-log entries → 사람이 읽는 상태 리포트 (순수함수, I/O 없음). */
export function renderStatus(entries: RunLogEntry[]): string {
  if (entries.length === 0) return "(empty run-log)";

  const state = deriveState(entries);
  const lines: string[] = [];

  lines.push(`run:    ${state.run_id.slice(0, 8)}   status: ${state.status}`);
  lines.push(`items:`);

  const counts: Record<string, number> = {};
  for (const it of state.items.values()) {
    counts[it.status] = (counts[it.status] ?? 0) + 1;
    lines.push(renderItemLine(it));
  }

  const summary = ["pass", "fail", "escalated", "in-progress", "pending"]
    .filter((s) => counts[s])
    .map((s) => `${s}=${counts[s]}`)
    .join("  ");
  lines.push(`summary: ${summary || "(no items)"}`);
  lines.push(`iterations: ${state.iterations}   spent_usd: $${state.budgetSpentUsd}   tokens: ${state.tokensSpent}`);

  return lines.join("\n");
}
