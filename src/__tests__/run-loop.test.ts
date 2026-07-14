// 첫 풀 루프 통합 테스트 — opts.adapter 심으로 mock 어댑터를 주입해 claude 없이 루프 전체를 구동한다.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCommand } from "../cli/run.js";
import { readEntries } from "../core/run-log.js";
import type { Adapter } from "../adapters/registry.js";
import type { StepOutput } from "../adapters/types.js";

const CHARTER_YAML = `
loopspec_version: "1.0"
name: looptest
readiness: L1
goal: "integration test goal"
scope:
  include: ["src/**"]
items:
  - id: a
    description: "item a"
    scope: { include: ["src/a.ts"] }
  - id: b
    description: "item b"
    scope: { include: ["src/b.ts"] }
  - id: c
    description: "item c"
    scope: { include: ["src/c.ts"] }
budget:
  max_iterations: 10
  max_attempts_per_item: 2
  max_consecutive_failures: 3
`;

function mockAdapter(step: () => StepOutput): Adapter & { calls: number } {
  const a = {
    name: "mock",
    calls: 0,
    preflight: async () => {},
    runStep: async () => {
      a.calls += 1;
      return step();
    },
  };
  return a;
}

const passStep = (input = 0, output = 0): StepOutput => ({
  text: "",
  isError: false,
  toolCalls: [],
  usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});

let tmp: string;
let charterPath: string;
let repoDir: string;
let prevCwd: string;

function logEntries() {
  const dir = join(tmp, ".loopspec", "runs");
  const files = readdirSync(dir);
  expect(files.length).toBe(1);
  return readEntries(join(dir, files[0]));
}

beforeEach(() => {
  prevCwd = process.cwd();
  tmp = mkdtempSync(join(tmpdir(), "loopspec-loop-"));
  charterPath = join(tmp, "looptest.charter.yaml");
  writeFileSync(charterPath, CHARTER_YAML);
  repoDir = join(tmp, "repo");
  mkdirSync(repoDir);
  process.chdir(tmp); // run-log 경로(.loopspec/runs)가 cwd 상대라 필수
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(tmp, { recursive: true, force: true });
});

describe("run loop with injected adapter", () => {
  it("--max-iter stops after N iterations", async () => {
    const adapter = mockAdapter(passStep);
    const code = await runCommand(charterPath, { repo: repoDir, adapter, maxIter: 1 });
    expect(code).toBe(0); // pending 아이템은 fail/escalated 가 아니므로 0
    expect(adapter.calls).toBe(1);
    const attempts = logEntries().filter((e) => e.event.type === "attempt-completed");
    expect(attempts.length).toBe(1);
  });

  it("--filter runs only the selected item but logs the full item list", async () => {
    const adapter = mockAdapter(passStep);
    const code = await runCommand(charterPath, { repo: repoDir, adapter, filter: "b" });
    expect(code).toBe(0);
    expect(adapter.calls).toBe(1);
    const entries = logEntries();
    const startedEvt = entries.find((e) => e.event.type === "run-started")!.event;
    expect(startedEvt.type === "run-started" && startedEvt.items).toEqual(["a", "b", "c"]);
    const attempted = entries.filter((e) => e.event.type === "attempt-completed").map((e) => (e.event as { item_id: string }).item_id);
    expect(attempted).toEqual(["b"]);
    const completed = entries.find((e) => e.event.type === "run-completed")!.event;
    expect(completed.type === "run-completed" && completed.scorecard.total).toBe(1);
  });

  it("+Nk trips budget-exceeded on tokens", async () => {
    const adapter = mockAdapter(() => passStep(40000, 20000));
    const code = await runCommand(charterPath, { repo: repoDir, adapter, tokenBump: "+50k" });
    expect(code).toBe(0);
    expect(adapter.calls).toBe(1); // 60000 > 50000 이라 두 번째 iteration 전에 stop
    const completed = logEntries().find((e) => e.event.type === "run-completed")!.event;
    expect(completed.type === "run-completed" && completed.scorecard.tokensSpent).toBe(60000);
  });

  it("--report-only executes nothing, writes nothing, skips preflight", async () => {
    const adapter = mockAdapter(passStep);
    adapter.preflight = async () => {
      throw new Error("preflight must not run in report-only");
    };
    const code = await runCommand(charterPath, { repo: repoDir, adapter, reportOnly: true });
    expect(code).toBe(0);
    expect(adapter.calls).toBe(0);
    expect(existsSync(join(tmp, ".loopspec"))).toBe(false);
  });

  it("unknown --agent fails closed listing known agents", async () => {
    const code = await runCommand(charterPath, { repo: repoDir, agent: "gpt-5" });
    expect(code).toBe(1);
    expect(existsSync(join(tmp, ".loopspec"))).toBe(false);
  });

  it("unknown --filter id fails closed before writing any log", async () => {
    const adapter = mockAdapter(passStep);
    const code = await runCommand(charterPath, { repo: repoDir, adapter, filter: "nope" });
    expect(code).toBe(1);
    expect(existsSync(join(tmp, ".loopspec"))).toBe(false);
  });

  it("malformed +Nk fails closed", async () => {
    const adapter = mockAdapter(passStep);
    const code = await runCommand(charterPath, { repo: repoDir, adapter, tokenBump: "50k" });
    expect(code).toBe(1);
  });

  it("resume with a fresh +Nk grants headroom past the old cap", async () => {
    // 1차: +50k 캡을 60000 토큰으로 초과 → budget-exceeded 로 중단
    const big = mockAdapter(() => passStep(40000, 20000));
    await runCommand(charterPath, { repo: repoDir, adapter: big, tokenBump: "+50k" });
    const runFile = readdirSync(join(tmp, ".loopspec", "runs"))[0];
    const run_id = runFile.replace(/^looptest-/, "").replace(/\.jsonl$/, "");

    // 2차 resume: 새 +50k → 유효 캡 = 60000 + 50000, 남은 아이템들이 진행됨
    const small = mockAdapter(() => passStep(500, 500));
    const code = await runCommand(charterPath, { repo: repoDir, adapter: small, resume: run_id, tokenBump: "+50k" });
    expect(code).toBe(0);
    expect(small.calls).toBe(2); // 남은 b, c 통과 → all-items-complete
    const entries = readEntries(join(tmp, ".loopspec", "runs", runFile));
    const finals = entries.filter((e) => e.event.type === "run-completed");
    const last = finals[finals.length - 1].event;
    expect(last.type === "run-completed" && last.scorecard.passed).toBe(3);
  });
});
