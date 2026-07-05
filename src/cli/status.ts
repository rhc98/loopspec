import { readdirSync, statSync, existsSync } from "fs";
import { resolve, join } from "path";
import { readEntries } from "../core/run-log.js";
import { renderStatus } from "../core/status.js";

function runsDir(): string {
  return resolve(process.cwd(), ".loopspec", "runs");
}

/** name 으로 시작하는(또는 전체) run-log 중 가장 최근 수정본 경로. 없으면 null. */
function latestLog(name?: string): string | null {
  const dir = runsDir();
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .filter((f) => (name ? f.startsWith(`${name}-`) : true))
    .map((f) => join(dir, f));
  if (files.length === 0) return null;
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/** 최근 run-log 의 상태를 출력. 통과 0, 로그 없음 1. */
export function statusCommand(name: string | undefined): number {
  const logPath = latestLog(name);
  if (!logPath) {
    console.error(`✗ no run-log found${name ? ` for "${name}"` : ""} under ${runsDir()}`);
    return 1;
  }
  console.log(`log: ${logPath}\n`);
  console.log(renderStatus(readEntries(logPath)));
  return 0;
}
