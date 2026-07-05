import { readFileSync } from "fs";
import yaml from "js-yaml";
import { validateCharter } from "../spec/validator.js";

/** charter 검증. 통과 0, 실패 1 반환. */
export function validateCommand(charterPath: string): number {
  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(charterPath, "utf8"));
  } catch (err) {
    console.error(`✗ cannot read/parse ${charterPath}: ${(err as Error).message}`);
    return 1;
  }

  const errors = validateCharter(raw);
  if (errors.length === 0) {
    console.log(`✓ ${charterPath} is valid`);
    return 0;
  }

  console.error(`✗ ${charterPath} has ${errors.length} error(s):`);
  for (const e of errors) console.error(`  [${e.rule}] ${e.message}`);
  return 1;
}
