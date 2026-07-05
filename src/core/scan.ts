import type { Charter } from "../spec/types.js";

// charter 신뢰 스캐너 — verify.commands(실행 셸 표면)와 scope 를 위험 패턴과 대조.
// 순수함수, I/O 없음. heuristic 이라 안전을 *증명하지 않는다* — 위험 신호를 사람 동의
// 결정에 노출할 뿐. false negative 가능(스캔 통과 ≠ 안전).

export type RiskLevel = "danger" | "warn";

export interface ScanFinding {
  level: RiskLevel;
  rule: string;
  where: string;
  snippet: string;
  message: string;
}

interface Pattern {
  rule: string;
  level: RiskLevel;
  re: RegExp;
  message: string;
}

// verify.commands 각 항목에 적용. run.ts 가 `execa(cmd, { shell: true })` 로 그대로 실행하므로
// 임의 셸 주입 표면이다.
const COMMAND_PATTERNS: Pattern[] = [
  { rule: "pipe-to-shell", level: "danger", re: /\|\s*(sh|bash|zsh|fish)\b/, message: "pipes output into a shell interpreter" },
  { rule: "remote-fetch", level: "danger", re: /\b(curl|wget)\b/, message: "fetches from the network (possible remote code)" },
  { rule: "remote-shell", level: "danger", re: /\b(nc|ncat|netcat|telnet)\b|(^|\s)ssh(\s|$)/, message: "opens a network / remote shell connection" },
  { rule: "destructive-delete", level: "danger", re: /\brm\s+-[a-zA-Z]*[rf]/, message: "recursive or forced file deletion" },
  { rule: "disk-write", level: "danger", re: /\bdd\b\s|\bmkfs\b|>\s*\/dev\//, message: "raw disk / device write" },
  { rule: "fork-bomb", level: "danger", re: /:\s*\(\s*\)\s*\{/, message: "fork bomb pattern" },
  { rule: "privilege", level: "danger", re: /\b(sudo|doas)\b|\bchmod\s+[0-7]*77[0-7]?\b|\bchmod\s+\+s\b/, message: "privilege escalation or permission widening" },
  { rule: "obfuscation", level: "danger", re: /\bbase64\s+(-d|-D|--decode)\b|\beval\b|\bxxd\b/, message: "decodes or evaluates an obfuscated payload" },
  { rule: "secret-access", level: "danger", re: /\bid_rsa\b|\.aws\/credentials|\.ssh\/|\.npmrc\b/, message: "reads credential / secret files" },
  { rule: "global-install", level: "danger", re: /\bnpm\s+(i|install)\b[^|&;]*(-g|--global)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\bgem\s+install\b/, message: "installs global packages (side effects outside the repo)" },
  { rule: "outside-repo", level: "warn", re: /(^|\s)\/(etc|usr|s?bin|var|root|Library|System)\b|(^|\s)~\//, message: "touches paths outside the repository" },
  { rule: "dotenv-access", level: "warn", re: /\.env\b/, message: "reads a .env file" },
  { rule: "command-substitution", level: "warn", re: /\$\(|`/, message: "uses dynamic command substitution" },
];

// scope.include 가 사실상 무엇이든 편집 가능하게 여는 값.
const BROAD_SCOPE = new Set(["**", "*", ".", "/", "**/*", "./**", "./*"]);

function scanCommand(cmd: string, where: string): ScanFinding[] {
  const out: ScanFinding[] = [];
  for (const p of COMMAND_PATTERNS) {
    if (p.re.test(cmd)) {
      out.push({ level: p.level, rule: p.rule, where, snippet: cmd, message: p.message });
    }
  }
  return out;
}

function scanScope(include: string[], where: string): ScanFinding[] {
  return include
    .filter((g) => BROAD_SCOPE.has(g.trim()))
    .map((g) => ({
      level: "warn" as const,
      rule: "broad-scope",
      where,
      snippet: g,
      message: "scope allows editing anything in the working tree",
    }));
}

/** charter 를 스캔해 위험 finding 목록 반환. 없으면 []. 순수함수. */
export function scanCharter(charter: Charter): ScanFinding[] {
  const findings: ScanFinding[] = [];

  const commands = charter.verify?.commands ?? [];
  commands.forEach((cmd, i) => findings.push(...scanCommand(cmd, `verify.commands[${i}]`)));

  findings.push(...scanScope(charter.scope?.include ?? [], "scope.include"));
  charter.items?.forEach((item, i) =>
    findings.push(...scanScope(item.scope?.include ?? [], `items[${i}].scope.include`)),
  );

  return findings;
}

/** danger 등급 finding 이 하나라도 있으면 true. */
export function hasDanger(findings: ScanFinding[]): boolean {
  return findings.some((f) => f.level === "danger");
}

/** finding 목록을 사람이 읽는 리포트로. 순수함수. */
export function renderFindings(findings: ScanFinding[]): string {
  if (findings.length === 0) return "  (no risk findings — heuristic scan, not a safety proof)";
  const order: RiskLevel[] = ["danger", "warn"];
  const lines: string[] = [];
  for (const level of order) {
    for (const f of findings.filter((x) => x.level === level)) {
      lines.push(`  [${level.toUpperCase()}] ${f.rule} (${f.where}): ${f.message}`);
      lines.push(`      ${f.snippet}`);
    }
  }
  return lines.join("\n");
}
