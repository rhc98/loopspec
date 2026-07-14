// Charter YAML 파싱 결과의 TS 타입 (Ship 1: Zod 없이 수동 인터페이스).

export interface Charter {
  loopspec_version: string;
  name: string;
  readiness: "L1" | "L2";
  goal: string;
  scope: { include: string[] };
  items: Item[];
  budget: Budget;
  verify?: Verify;
  denylist?: string[];
}

export interface Item {
  id: string;
  description: string;
  scope: { include: string[] };
}

export interface Budget {
  max_budget_usd?: number;
  per_step_max_budget_usd?: number;
  max_tokens?: number; // input+output 토큰 누적 캡 (cache 토큰 제외). 없으면 무제한.
  max_iterations: number;
  max_attempts_per_item: number;
  max_consecutive_failures: number;
}

export interface Verify {
  commands?: string[];
}
