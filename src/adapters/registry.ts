// --agent 이름 → 어댑터 매핑. 컨트롤 루프는 이 인터페이스만 본다.
import type { StepInput, StepOutput } from "./types.js";
import * as claudeCode from "./claude-code.js";

export interface Adapter {
  name: string;
  preflight(): Promise<void>;
  runStep(input: StepInput): Promise<StepOutput>;
}

const REGISTRY: Record<string, Adapter> = {
  "claude-code": { name: "claude-code", preflight: claudeCode.preflight, runStep: claudeCode.runStep },
};

export function knownAgents(): string[] {
  return Object.keys(REGISTRY);
}

/** 모르는 이름이면 null — caller 가 fail-closed 처리. */
export function getAdapter(name: string): Adapter | null {
  return REGISTRY[name] ?? null;
}
