// 어댑터 경계 타입. 컨트롤러는 이 타입만 보고 특정 LLM CLI를 모른다.

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  total_cost_usd?: number;
}

export interface StepInput {
  prompt: string;
  allowedTools: string[]; // 화이트리스트 e.g. ["Read", "Edit"]
  disallowedTools?: string[]; // charter denylist → --disallowedTools (방어적 추가 차단)
  maxTurns: number;
  cwd: string; // target repo working dir
}

export interface StepOutput {
  text: string;
  usage?: Usage;
  isError: boolean;
  toolCalls: string[];
  permissionDenials?: string[]; // result.permission_denials 감사용 (차단된 도구 이름)
  spawnError?: string;
}
