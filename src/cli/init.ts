import { writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { charterTemplate } from "../spec/template.js";

/** charter 스캐폴드. <name>.charter.yaml 생성. 통과 0, 실패 1. */
export function initCommand(name: string, opts: { force?: boolean }): number {
  const path = resolve(process.cwd(), `${name}.charter.yaml`);
  if (existsSync(path) && !opts.force) {
    console.error(`✗ ${path} already exists (use --force to overwrite)`);
    return 1;
  }
  writeFileSync(path, charterTemplate(name));
  console.log(`✓ wrote ${path}`);
  console.log(`  next: edit it, then  loopspec validate ${name}.charter.yaml`);
  return 0;
}
