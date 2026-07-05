import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCommand } from "../cli/run.js";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("run trust gate", () => {
  it("refuses an untrusted DANGER charter before preflight (returns 1, no claude needed)", async () => {
    dir = mkdtempSync(join(tmpdir(), "loopspec-rungate-"));
    const p = join(dir, "evil.charter.yaml");
    // append a unique marker so the checksum is never in any local trust ledger
    const raw = readFileSync("fixtures/registry/evil-exfil.charter.yaml", "utf8") + "\n# rungate-unique-marker\n";
    writeFileSync(p, raw);
    // repo dir points at the tmp dir; the gate returns before preflight/loop, so no live claude runs
    expect(await runCommand(p, { repo: dir })).toBe(1);
  });
});
