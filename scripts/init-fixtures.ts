// Create or reset fixtures/mini-repo — the intentionally-broken nested git repo
// that `loopspec run` targets in the quick start. The parent repo gitignores it
// (git cannot track a nested repo), so fresh clones must run `npm run fixtures:init`.
import { execa } from "execa";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MINI_REPO = join("fixtures", "mini-repo");

// Snapshot of the fixture target. Must stay consistent with the item scopes in
// fixtures/multi-charter.yaml (fix-a-ts → src/a.ts, fix-b-ts → src/b.ts).
const FILES: Record<string, string> = {
  "src/a.ts": `// Intentional type error: passing number where string expected
function greet(name: string): string {
  return "Hello, " + name;
}

const result = greet(42); // TS2345: Argument of type 'number' is not assignable to parameter of type 'string'
console.log(result);
`,
  "src/b.ts": `// Intentional unused variable (noUnusedLocals will flag this)
export function add(x: number, y: number): number {
  const unused = "this variable is never used"; // TS6133
  return x + y;
}
`,
  "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUnusedLocals": true
  },
  "include": ["src/**/*"]
}
`,
};

const git = (args: string[]) => execa("git", ["-C", MINI_REPO, ...args]);

async function main(): Promise<void> {
  if (existsSync(join(MINI_REPO, ".git"))) {
    await git(["checkout", "HEAD", "--", "."]);
    console.log(`✓ ${MINI_REPO} reset to HEAD (broken fixture state restored)`);
    return;
  }

  for (const [relPath, content] of Object.entries(FILES)) {
    const abs = join(MINI_REPO, relPath);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  await execa("git", ["init", MINI_REPO]);
  // Local identity so the fixture commit works in bare CI environments.
  await git(["config", "user.email", "fixtures@loopspec.invalid"]);
  await git(["config", "user.name", "loopspec fixtures"]);
  await git(["add", "."]);
  await git(["commit", "-m", "Initial fixture: TS files with intentional errors"]);
  console.log(`✓ ${MINI_REPO} created (nested git repo with intentional TS errors at HEAD)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
