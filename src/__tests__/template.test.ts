import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { charterTemplate } from "../spec/template.js";
import { validateCharter } from "../spec/validator.js";

describe("charterTemplate (loopspec init)", () => {
  it("produces a charter that passes validation", () => {
    const raw = yaml.load(charterTemplate("demo"));
    expect(validateCharter(raw)).toEqual([]);
  });

  it("embeds the given name", () => {
    expect(charterTemplate("my-charter")).toContain("name: my-charter");
  });
});
