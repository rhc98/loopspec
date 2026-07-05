// 멀티 아이템에서 scope containment 를 step 단위로 판정하는 순수함수.
// before = step 시작 시점의 dirty 파일(이전 통과 아이템 변경분 포함).
// after  = step 종료 시점의 dirty 파일.

/** 이번 step 이 새로 건드린 파일 = after 에는 있고 before 에는 없던 것. */
export function stepChangedFiles(before: string[], after: string[]): string[] {
  const beforeSet = new Set(before);
  return after.filter((f) => !beforeSet.has(f));
}

/** 이번 step 변경분 중 allowed(scope.include) 밖 파일 = 위반. */
export function scopeViolations(before: string[], after: string[], allowed: string[]): string[] {
  const allowedSet = new Set(allowed);
  return stepChangedFiles(before, after).filter((f) => !allowedSet.has(f));
}
