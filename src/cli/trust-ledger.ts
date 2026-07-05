import { createHash } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";

// 로컬 신뢰 원장(.loopspec/trust.json) — 동의한 charter 를 content checksum 으로 기록.
// checksum 키라서 같은 name 이라도 내용이 다르면 재동의를 요구(=서명 B 의 씨앗).
// .loopspec/ 는 gitignore — 커밋 안 됨, 머신 로컬 상태.

export interface TrustEntry {
  name: string;
  origin: string;
  checksum: string; // sha256:<hex> of raw charter bytes
  consented: boolean;
  ts: string;
  dangerRules: string[];
}

interface Ledger {
  entries: TrustEntry[];
}

function ledgerPath(cwd: string): string {
  return resolve(cwd, ".loopspec", "trust.json");
}

export function charterChecksum(raw: string): string {
  return "sha256:" + createHash("sha256").update(raw, "utf8").digest("hex");
}

export function loadLedger(cwd: string): Ledger {
  const p = ledgerPath(cwd);
  if (!existsSync(p)) return { entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(parsed?.entries) ? (parsed as Ledger) : { entries: [] };
  } catch {
    return { entries: [] };
  }
}

/** 이 checksum 의 charter 가 동의 상태로 기록돼 있으면 true. */
export function isConsented(cwd: string, checksum: string): boolean {
  return loadLedger(cwd).entries.some((e) => e.checksum === checksum && e.consented);
}

/** 동의 기록 append (같은 checksum 이면 idempotent). */
export function appendConsent(cwd: string, entry: TrustEntry): void {
  const p = ledgerPath(cwd);
  mkdirSync(dirname(p), { recursive: true });
  const ledger = loadLedger(cwd);
  if (!ledger.entries.some((e) => e.checksum === entry.checksum)) {
    ledger.entries.push(entry);
  }
  writeFileSync(p, JSON.stringify(ledger, null, 2) + "\n");
}
