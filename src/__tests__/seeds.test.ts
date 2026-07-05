import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { dirname, resolve, join } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { validateCharter } from "../spec/validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEEDS = resolve(__dirname, "../../seeds");

describe("seed charters", () => {
  const files = readdirSync(SEEDS).filter((f) => f.endsWith(".yaml"));

  it("ships at least one seed", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f} passes validateCharter`, () => {
      const raw = yaml.load(readFileSync(join(SEEDS, f), "utf8"));
      expect(validateCharter(raw)).toEqual([]);
    });
  }
});
