// CLI 오버라이드(+Nk / --max-iter / --filter)를 effective charter 로 환원. 순수 (no I/O).
import type { Charter } from "../spec/types.js";

export interface RunOverrides {
  maxIterations?: number; // --max-iter
  tokenBump?: number; // 파싱된 +Nk 값 (토큰 수)
  filterIds?: string[]; // --filter, 정확 id 매칭
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
 * tokenBump 는 additive headroom: 유효 캡 = 시작 시점 누적 토큰 + N
 * (fresh run 은 spent=0 이라 캡=N, resume 는 추가 헤드룸).
 * errors 가 비어있지 않으면 caller 가 실행 거부(fail-closed).
 */
export function applyOverrides(
  charter: Charter,
  overrides: RunOverrides,
  tokensSpentAtStart: number,
): { charter: Charter; errors: string[] } {
  const errors: string[] = [];
  const effective: Charter = { ...charter, budget: { ...charter.budget } };

  if (overrides.maxIterations !== undefined) {
    effective.budget.max_iterations = overrides.maxIterations;
  }

  if (overrides.tokenBump !== undefined) {
    effective.budget.max_tokens = tokensSpentAtStart + overrides.tokenBump;
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
