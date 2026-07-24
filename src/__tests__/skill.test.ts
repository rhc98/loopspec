import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "fs";
import { basename, dirname, resolve, join } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { validateCharter } from "../spec/validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SKILL_DIR = resolve(ROOT, "skills/loopspec");
const SKILL_MD = join(SKILL_DIR, "SKILL.md");
const MARKETPLACE = resolve(ROOT, ".claude-plugin/marketplace.json");

/** SKILL.md 를 frontmatter(YAML) 와 body 로 분리. 구분자가 없으면 fail-closed. */
function splitFrontmatter(src: string): { fm: Record<string, unknown>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(src);
  if (!m) throw new Error("SKILL.md has no YAML frontmatter block");
  return { fm: yaml.load(m[1]) as Record<string, unknown>, body: m[2] };
}

/** ```yaml charter 펜스만 수집 — 완전한 차터임을 저자가 명시한 블록. 설명용 ```yaml 조각은 제외. */
function completeCharterBlocks(body: string): string[] {
  return [...body.matchAll(/^```yaml charter\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
}

const src = readFileSync(SKILL_MD, "utf8");
const { fm, body } = splitFrontmatter(src);

describe("skill frontmatter", () => {
  it("name matches the skill directory", () => {
    expect(fm.name).toBe(basename(SKILL_DIR));
  });

  it("name obeys the skill naming rules", () => {
    expect(fm.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("description is present and within the 1024-char cap", () => {
    const d = fm.description;
    expect(typeof d).toBe("string");
    expect((d as string).trim().length).toBeGreaterThan(0);
    expect((d as string).length).toBeLessThanOrEqual(1024);
  });

  it("declares a metadata.version", () => {
    expect((fm.metadata as Record<string, unknown> | undefined)?.version).toBeTruthy();
  });

  it("allows the tools the workflow actually invokes", () => {
    const allowed = String(fm["allowed-tools"] ?? "");
    for (const t of ["loopspec", "git", "npm", "claude"]) {
      expect(allowed).toContain(`Bash(${t} *)`);
    }
  });

  it("omits frontmatter keys that break this skill", () => {
    // context: fork 는 멀티턴 인터뷰를 죽이고, disable-model-invocation 은 자동 트리거를 막는다.
    for (const k of ["context", "disable-model-invocation", "when_to_use", "argument-hint"]) {
      expect(fm).not.toHaveProperty(k);
    }
  });

  it("body stays under the 500-line budget", () => {
    expect(body.split("\n").length).toBeLessThan(500);
  });
});

describe("embedded charter examples", () => {
  const blocks = completeCharterBlocks(body);

  it("SKILL.md documents at least one complete charter somewhere in the skill", () => {
    const refBlocks = readdirSync(join(SKILL_DIR, "references"))
      .filter((f) => f.endsWith(".md"))
      .flatMap((f) => completeCharterBlocks(readFileSync(join(SKILL_DIR, "references", f), "utf8")));
    expect(blocks.length + refBlocks.length).toBeGreaterThan(0);
  });

  // SKILL.md + references 의 모든 ```yaml charter 블록을 한 번에 검사
  const all: Array<[string, string]> = [
    ...blocks.map((b, i) => [`SKILL.md#${i}`, b] as [string, string]),
    ...readdirSync(join(SKILL_DIR, "references"))
      .filter((f) => f.endsWith(".md"))
      .flatMap((f) =>
        completeCharterBlocks(readFileSync(join(SKILL_DIR, "references", f), "utf8")).map(
          (b, i) => [`references/${f}#${i}`, b] as [string, string],
        ),
      ),
  ];

  for (const [label, block] of all) {
    describe(label, () => {
      const raw = yaml.load(block) as Record<string, unknown>;

      it("passes validateCharter", () => {
        expect(validateCharter(raw)).toEqual([]);
      });

      // validator 가 요구하지 않는 4필드 — 빠지면 런타임에서 조용히 깨진다.
      it("emits name, goal, readiness, and top-level scope", () => {
        expect(raw.name).toBeTruthy();
        expect(raw.goal).toBeTruthy();
        expect(raw.readiness).toBeTruthy();
        expect((raw.scope as { include?: unknown } | undefined)?.include).toBeTruthy();
      });

      // validator 는 미지 필드를 조용히 무시하므로 validateCharter 로는 잡히지 않는다.
      it("emits no deferred (never-emit) fields", () => {
        expect(raw).not.toHaveProperty("parameters");
        expect(raw).not.toHaveProperty("engine");
        expect(raw).not.toHaveProperty("model");
        expect(raw.verify ?? {}).not.toHaveProperty("env_from");
        for (const item of (raw.items ?? []) as Array<Record<string, unknown>>) {
          expect(item).not.toHaveProperty("depends_on");
          expect(item).not.toHaveProperty("budget");
        }
      });
    });
  }
});

describe("seeds reference", () => {
  it("mentions every shipped seed charter", () => {
    const doc = readFileSync(join(SKILL_DIR, "references/seeds.md"), "utf8");
    const seeds = readdirSync(resolve(ROOT, "seeds")).filter((f) => f.endsWith(".charter.yaml"));
    expect(seeds.length).toBeGreaterThan(0);
    for (const s of seeds) expect(doc).toContain(s);
  });
});

describe("marketplace manifest", () => {
  const mf = JSON.parse(readFileSync(MARKETPLACE, "utf8"));

  it("declares strict: false so no plugin.json is required", () => {
    expect(mf.plugins[0].strict).toBe(false);
  });

  it("points at skill paths that exist", () => {
    const paths: string[] = mf.plugins[0].skills;
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(existsSync(resolve(ROOT, p))).toBe(true);
  });

  it("every referenced skill directory has a SKILL.md", () => {
    for (const p of mf.plugins[0].skills as string[]) {
      expect(existsSync(resolve(ROOT, p, "SKILL.md"))).toBe(true);
    }
  });
});
