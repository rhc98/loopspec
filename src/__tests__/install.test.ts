import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { installCommand } from "../cli/install.js";

const REGISTRY = resolve("fixtures/registry");

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});
function tmp(): string {
  dir = mkdtempSync(join(tmpdir(), "loopspec-install-"));
  return dir;
}
function ledger(d: string): { entries: { name: string; consented: boolean; checksum: string; dangerRules: string[] }[] } {
  return JSON.parse(readFileSync(join(d, ".loopspec", "trust.json"), "utf8"));
}

describe("installCommand", () => {
  it("installs a benign charter and records consent", () => {
    const d = tmp();
    expect(installCommand("tsc-green", { registry: REGISTRY, cwd: d, dest: d })).toBe(0);
    expect(existsSync(join(d, "tsc-green.charter.yaml"))).toBe(true);
    const l = ledger(d);
    expect(l.entries).toHaveLength(1);
    expect(l.entries[0]).toMatchObject({ name: "tsc-green", consented: true });
    expect(l.entries[0].checksum).toMatch(/^sha256:/);
    expect(l.entries[0].dangerRules).toEqual([]);
  });

  it("refuses a danger charter without --yes and writes nothing", () => {
    const d = tmp();
    expect(installCommand("evil-exfil", { registry: REGISTRY, cwd: d, dest: d })).toBe(1);
    expect(existsSync(join(d, "evil-exfil.charter.yaml"))).toBe(false);
    expect(existsSync(join(d, ".loopspec", "trust.json"))).toBe(false);
  });

  it("installs a danger charter with explicit --yes and records danger rules", () => {
    const d = tmp();
    expect(installCommand("evil-exfil", { registry: REGISTRY, cwd: d, dest: d, yes: true })).toBe(0);
    expect(existsSync(join(d, "evil-exfil.charter.yaml"))).toBe(true);
    expect(ledger(d).entries[0].dangerRules.length).toBeGreaterThan(0);
  });

  it("report-only scans but writes nothing (even for danger)", () => {
    const d = tmp();
    expect(installCommand("evil-exfil", { registry: REGISTRY, cwd: d, dest: d, reportOnly: true })).toBe(0);
    expect(existsSync(join(d, "evil-exfil.charter.yaml"))).toBe(false);
    expect(existsSync(join(d, ".loopspec", "trust.json"))).toBe(false);
  });

  it("fails closed on an unresolvable source", () => {
    const d = tmp();
    expect(installCommand("does-not-exist", { registry: REGISTRY, cwd: d, dest: d })).toBe(1);
  });

  it("refuses to overwrite an existing dest without --force", () => {
    const d = tmp();
    expect(installCommand("tsc-green", { registry: REGISTRY, cwd: d, dest: d })).toBe(0);
    expect(installCommand("tsc-green", { registry: REGISTRY, cwd: d, dest: d })).toBe(1); // exists, no --force
    expect(installCommand("tsc-green", { registry: REGISTRY, cwd: d, dest: d, force: true })).toBe(0);
  });
});
