import { describe, it, expect } from "vitest";
import { stepChangedFiles, scopeViolations } from "../core/scope.js";

describe("stepChangedFiles", () => {
  it("returns only files newly dirtied this step", () => {
    expect(stepChangedFiles(["src/a.ts"], ["src/a.ts", "src/b.ts"])).toEqual(["src/b.ts"]);
  });

  it("empty when this step changed nothing new", () => {
    expect(stepChangedFiles(["src/a.ts"], ["src/a.ts"])).toEqual([]);
  });
});

describe("scopeViolations", () => {
  // 회귀: 이전 통과 아이템(a.ts)이 dirty 인 상태에서 b.ts 스텝이 b.ts 만 건드리면 위반 없어야 함.
  it("does NOT flag a prior passed item's change (the multi-item bug)", () => {
    const before = ["src/a.ts"]; // fix-a-ts 가 통과 후 남긴 변경
    const after = ["src/a.ts", "src/b.ts"]; // fix-b-ts 가 b.ts 추가 수정
    expect(scopeViolations(before, after, ["src/b.ts"])).toEqual([]);
  });

  it("flags a genuinely out-of-scope file touched this step", () => {
    const before = ["src/a.ts"];
    const after = ["src/a.ts", "src/b.ts", "src/evil.ts"];
    expect(scopeViolations(before, after, ["src/b.ts"])).toEqual(["src/evil.ts"]);
  });

  it("clean step within scope -> no violations", () => {
    expect(scopeViolations([], ["src/b.ts"], ["src/b.ts"])).toEqual([]);
  });
});
