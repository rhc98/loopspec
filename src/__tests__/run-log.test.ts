import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync } from "fs";
import { randomUUID } from "crypto";
import { appendEntry, readEntries, SCHEMA_VERSION } from "../core/run-log.js";

let logPath = "";
afterEach(() => {
  if (logPath) rmSync(logPath, { force: true });
});

describe("run-log append/read round-trip", () => {
  it("writes and reads back entries in order with schema_version", () => {
    logPath = join(tmpdir(), `loopspec-${randomUUID()}.jsonl`);
    const run_id = "run-123";

    appendEntry(logPath, run_id, { type: "run-started", charter: "c.yaml", run_id, items: ["a", "b"] });
    appendEntry(logPath, run_id, { type: "attempt-started", item_id: "a", attempt: 1 });
    appendEntry(logPath, run_id, { type: "attempt-completed", item_id: "a", attempt: 1, outcome: "pass" });

    const entries = readEntries(logPath);
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.schema_version === SCHEMA_VERSION)).toBe(true);
    expect(entries.every((e) => e.run_id === run_id)).toBe(true);
    expect(entries[0].event.type).toBe("run-started");
    expect(entries[1].event).toMatchObject({ type: "attempt-started", item_id: "a", attempt: 1 });
    expect(entries[2].event).toMatchObject({ type: "attempt-completed", outcome: "pass" });
  });

  it("readEntries on a missing file returns []", () => {
    expect(readEntries(join(tmpdir(), `nope-${randomUUID()}.jsonl`))).toEqual([]);
  });
});
