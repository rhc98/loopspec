import { writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import yaml from "js-yaml";
import type { Charter } from "../spec/types.js";
import { validateCharter } from "../spec/validator.js";
import { scanCharter, hasDanger, renderFindings } from "../core/scan.js";
import { resolveCharter } from "./registry.js";
import { charterChecksum, appendConsent } from "./trust-ledger.js";

export interface InstallOpts {
  registry?: string;
  yes?: boolean;
  force?: boolean;
  reportOnly?: boolean;
  dest?: string;
  cwd?: string; // 신뢰 원장/대상 base (기본 process.cwd()); 테스트에서 주입.
}

/** charter 를 해석→검증→스캔→프리뷰→동의 게이트→설치+동의 기록.
 *  통과 0, 거부/에러 1. */
export function installCommand(source: string, opts: InstallOpts = {}): number {
  const cwd = opts.cwd ?? process.cwd();

  let resolved;
  try {
    resolved = resolveCharter(source, { registry: opts.registry });
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    return 1;
  }

  const raw = resolved.raw;
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (e) {
    console.error(`✗ invalid YAML: ${(e as Error).message}`);
    return 1;
  }

  // fail-closed: 무효 charter 는 절대 설치하지 않는다.
  const errors = validateCharter(parsed);
  if (errors.length > 0) {
    console.error(`✗ charter failed validation (${errors.length}) — not installed:`);
    for (const e of errors) console.error(`  [${e.rule}] ${e.message}`);
    return 1;
  }

  const charter = parsed as Charter;
  const findings = scanCharter(charter);
  const cmds = charter.verify?.commands ?? [];

  console.log(`charter:  ${charter.name}   (from ${resolved.origin})`);
  console.log(`goal:     ${charter.goal}`);
  console.log(`items:    ${charter.items.map((i) => i.id).join(", ")}`);
  console.log(`scope:    ${charter.scope.include.join(", ")}`);
  console.log(`verify.commands:`);
  if (cmds.length === 0) console.log(`  (none)`);
  else for (const c of cmds) console.log(`  $ ${c}`);
  console.log(`scan:`);
  console.log(renderFindings(findings));

  if (opts.reportOnly) {
    console.log(`\n(report-only — nothing written)`);
    return 0;
  }

  // consent gate — danger 는 명시적 --yes 필수, 없으면 fail-closed.
  if (hasDanger(findings) && !opts.yes) {
    console.error(`\n✗ refused: charter has DANGER-level findings. Re-run with --yes to consent explicitly.`);
    return 1;
  }

  const dest = resolve(cwd, opts.dest ?? ".", `${charter.name}.charter.yaml`);
  if (existsSync(dest) && !opts.force) {
    console.error(`\n✗ ${dest} already exists. Re-run with --force to overwrite.`);
    return 1;
  }
  writeFileSync(dest, raw);

  appendConsent(cwd, {
    name: charter.name,
    origin: resolved.origin,
    checksum: charterChecksum(raw),
    consented: true,
    ts: new Date().toISOString(),
    dangerRules: findings.filter((f) => f.level === "danger").map((f) => f.rule),
  });

  console.log(`\n✓ installed ${charter.name} -> ${dest}`);
  console.log(`  recorded consent in ${resolve(cwd, ".loopspec", "trust.json")}`);
  return 0;
}
