// `loopspec init` 이 쓰는 starter charter. validateCharter 를 통과하는 L1 최소 골격.

export function charterTemplate(name: string): string {
  return `loopspec_version: "1.0"
name: ${name}
readiness: L1                # L1: verify.commands 비어도 됨 / L2: 비면 안 됨
goal: "Describe the convergent goal for this charter"
scope:
  include:
    - "src/**"
items:
  - id: item-1
    description: "Describe the first scoped task"
    scope:
      include: ["src/example.ts"]   # 이 아이템 step 이 편집해도 되는 파일만
budget:
  max_budget_usd: 2.00
  per_step_max_budget_usd: 0.50
  max_iterations: 4
  max_attempts_per_item: 2
  max_consecutive_failures: 2
verify:
  commands: []                # L2 로 올리면 여기에 결정적 검증 명령을 넣는다
denylist: []                  # allowedTools(Read,Edit) 외에 추가로 막을 도구 이름
`;
}
