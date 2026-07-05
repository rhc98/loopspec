import { openSync, writeSync, fsyncSync, closeSync, mkdirSync, readFileSync, existsSync } from "fs";
import { dirname } from "path";
import type { Usage } from "../adapters/types.js";
import type { Scorecard } from "./state.js";

export const SCHEMA_VERSION = 1;

export type RunLogEvent =
  | { type: "run-started"; charter: string; run_id: string; items: string[] }
  | { type: "run-resumed" }
  | { type: "attempt-started"; item_id: string; attempt: number }
  | { type: "scope-violated"; item_id: string; files: string[] }
  | { type: "denylist-blocked"; item_id: string; tools: string[] }
  | { type: "attempt-completed"; item_id: string; attempt: number; outcome: "pass" | "fail" | "escalated"; usage?: Usage }
  | { type: "item-escalated"; item_id: string; reason: string }
  | { type: "run-completed"; scorecard: Scorecard };

export interface RunLogEntry {
  schema_version: typeof SCHEMA_VERSION;
  ts: string;
  run_id: string;
  event: RunLogEvent;
}

/** append-only JSONL writer. row 단위 fsync 로 crash durability 보장. */
export function appendEntry(logPath: string, run_id: string, event: RunLogEvent): RunLogEntry {
  mkdirSync(dirname(logPath), { recursive: true });
  const entry: RunLogEntry = {
    schema_version: SCHEMA_VERSION,
    ts: new Date().toISOString(),
    run_id,
    event,
  };
  const fd = openSync(logPath, "a");
  try {
    writeSync(fd, JSON.stringify(entry) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return entry;
}

export function readEntries(logPath: string): RunLogEntry[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunLogEntry);
}
