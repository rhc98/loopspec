// CLI 오버라이드(+Nk / --max-iter / --filter)를 effective charter 로 환원. 순수 (no I/O).
import type { Charter } from "../spec/types.js";

export interface RunOverrides {
  maxIterations?: number; // --max-iter (이번 실행에서 N번 더)
  tokenBump?: string; // raw "+Nk" positional (예: "+50k")
  filterIds?: string[]; // --filter, 정확 id 매칭
}

/** 오버라이드의 기준점 — resume 시 이미 소비한 양. fresh run 은 둘 다 0. */
export interface SpentAtStart {
  tokens: number;
  iterations: number;
}

/** "+50k" → 50000, "+500" → 500, 그 외(부호 없음/소수/음수 등) → null. */
export function parseTokenBump(arg: string): number | null {
  const m = /^\+(\d+)([kK])?$/.exec(arg);
  if (!m) return null;
  const n = parseInt(m[1], 10) * (m[2] ? 1000 : 1);
  return n > 0 ? n : null;
}

/**
 * 오버라이드를 반영한 effective charter 를 반환. 원본은 불변.
 * +Nk 와 --max-iter 모두 additive headroom 으로 동일한 멘탈 모델:
 * 유효 캡 = 시작 시점 소비량 + N (fresh run 은 소비량 0 이라 캡 = N,
 * resume 는 "N 만큼 더"). 모든 검증 에러는 errors 로 모이며,
 * 비어있지 않으면 caller 가 실행 거부(fail-closed).
 */
export function applyOverrides(
  charter: Charter,
  overrides: RunOverrides,
  spent: SpentAtStart,
): { charter: Charter; errors: string[] } {
  const errors: string[] = [];
  const effective: Charter = { ...charter, budget: { ...charter.budget } };

  if (overrides.maxIterations !== undefined) {
    if (!Number.isInteger(overrides.maxIterations) || overrides.maxIterations <= 0) {
      errors.push(`max-iter: invalid value "${overrides.maxIterations}" — expected a positive integer`);
    } else {
      effective.budget.max_iterations = spent.iterations + overrides.maxIterations;
    }
  }

  if (overrides.tokenBump !== undefined) {
    const bump = parseTokenBump(overrides.tokenBump);
    if (bump === null) {
      errors.push(`token budget: invalid value "${overrides.tokenBump}" — expected +N or +Nk (e.g. +50k)`);
    } else {
      effective.budget.max_tokens = spent.tokens + bump;
    }
  }

  if (overrides.filterIds !== undefined) {
    const known = new Set(charter.items.map((i) => i.id));
    for (const id of overrides.filterIds) {
      if (!known.has(id)) {
        errors.push(`filter: unknown item id "${id}" (known: ${charter.items.map((i) => i.id).join(", ")})`);
      }
    }
    const wanted = new Set(overrides.filterIds);
    effective.items = charter.items.filter((i) => wanted.has(i.id));
    if (errors.length === 0 && effective.items.length === 0) {
      errors.push("filter: no items matched");
    }
  }

  return { charter: effective, errors };
}

/** 활성 오버라이드의 한 줄 요약 (run 배너용). 없으면 null. */
export function describeOverrides(overrides: RunOverrides, effective: Charter): string | null {
  const parts: string[] = [];
  if (overrides.maxIterations !== undefined) parts.push(`max-iter=+${overrides.maxIterations} (cap ${effective.budget.max_iterations})`);
  if (overrides.tokenBump !== undefined) parts.push(`tokens=${overrides.tokenBump} (cap ${effective.budget.max_tokens})`);
  if (overrides.filterIds !== undefined) parts.push(`filter=${overrides.filterIds.join(",")}`);
  return parts.length > 0 ? parts.join("  ") : null;
}
