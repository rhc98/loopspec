import { readdirSync, statSync, existsSync } from "fs";
import { resolve, join } from "path";
import { readEntries } from "../core/run-log.js";
import { computeStats, renderStats } from "../core/stats.js";

function runsDir(): string {
  return resolve(process.cwd(), ".loopspec", "runs");
}

/** name 으로 시작하는(또는 전체) run-log 전부, 오래된→최신 순 (트렌드 방향). */
function allLogs(name?: string): string[] {
  const dir = runsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .filter((f) => (name ? f.startsWith(`${name}-`) : true))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
}

/** 매칭되는 모든 run-log 를 cross-run 집계해 출력. 통과 0, 로그 없음 1. */
export function statsCommand(name: string | undefined): number {
  const logs = allLogs(name);
  if (logs.length === 0) {
    console.error(`✗ no run-logs found${name ? ` for "${name}"` : ""} under ${runsDir()}`);
    return 1;
  }
  const runs = logs.map((p) => readEntries(p));
  console.log(renderStats(computeStats(runs), name));
  return 0;
}
