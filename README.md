[English](README.en.md) | **한국어**

# loopspec

**경계가 있고 감사 가능한 LLM 자동화를 위한 수렴형 스윕 엔진.**

![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)
![tests: 84 passing](https://img.shields.io/badge/tests-84%20passing-brightgreen.svg)

`loopspec`은 YAML **차터(charter)** — 목표를 범위가 지정된 항목들로 쪼갠 파일 — 를 받아,
각 항목을 고치기 위해 `claude -p` 스텝을 실행하는 경계가 있는 제어 루프를 구동합니다. 각 스텝이
자신에게 허용된 scope의 파일만 수정하도록 기계적으로 강제하고, 선택적으로 verify 명령을 실행하며,
모든 결정을 추가 전용 run-log에 기록합니다. 루프는 명시적인 예산, 시도 횟수, 연속
실패 한도 아래에서 스코어카드(`passed` / `failed` / `escalated`)로 수렴합니다.

## 왜 필요한가

LLM에게 넓은 편집 권한을 주고 알아서 잘하길 바라는 방식은 파일 몇 개를 넘어가면 확장되지 않습니다 —
자꾸 벗어나고, 과도하게 고치고, 자기 작업을 스스로 "검증"해버립니다. `loopspec`은
이를 뒤집습니다: 수렴과 정지를 소유하는 것은 모델이 아니라 **오케스트레이터**입니다.

- 모델은 한 번에 하나의 범위 지정된 항목만 보며, `--allowedTools Read,Edit`만 허용되고 스스로
  검증할 수 없습니다.
- 매 스텝 이후, `loopspec`은 대상 저장소의 워킹트리를 스텝 전/후로 diff하여 새로 변경된 파일들이
  해당 항목의 scope에 속하는 부분집합인지 확인합니다. 위반 시 그 스텝의 변경만 롤백하고 항목을
  escalate합니다 — 이전에 통과한 항목들의 변경 사항은 그대로 유지됩니다.
- 모든 결정(시도 시작, scope 위반, 항목 escalate, run 완료 등)은 추가 전용 run-log에 한 줄의
  JSONL로 기록됩니다. run 상태는 절대 그 자리에서 변경되지 않고 — 항상 로그를 재생(replay)
  하여 다시 계산됩니다. 이 덕분에 `loopspec run --resume <runId>`로 재개할 수 있습니다.
- 차터는 `verify.commands`에 실행 가능한 셸 명령을 담을 수 있습니다. 따라서 차터를 공유하는 것은
  실제 인젝션 벡터가 될 수 있어, `loopspec install`은 위험한 패턴을 스캔하고 신뢰할 수 없는 것을
  쓰거나 실행하기 전에 명시적 동의를 요구합니다 (아래에서 자세히 설명합니다).

## 설치

```bash
npm install -g loopspec
loopspec --version
loopspec init my-sweep   # 시작용 차터 스캐폴드
```

## 빠른 시작 (소스에서)

아래는 저장소의 번들 fixture를 사용하므로 소스 체크아웃 기준입니다:

```bash
git clone https://github.com/rhc98/loopspec.git
cd loopspec
npm install
npm test                 # 유닛 테스트 84개, 결정적, 네트워크 불필요
```

차터를 검증합니다 (fail-closed — 0이 아닌 종료 코드는 실행하지 말라는 뜻입니다):

```bash
npm run validate -- fixtures/multi-charter.yaml
# ✓ fixtures/multi-charter.yaml is valid

npm run validate -- fixtures/mini-charter.yaml
# ✗ fixtures/mini-charter.yaml has 2 error(s):
#   [loopspec_version] loopspec_version is required (non-empty string)
#   [items] items must be a non-empty array
```

번들된 fixture 대상 위에서 수렴형 스윕을 실행합니다 (**로그인된** `claude` CLI가 필요합니다 —
구독 키체인 또는 `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`; `preflight`는 바이너리 존재
여부만 확인하므로, 로그인되지 않은 CLI는 시작 시 에러가 아니라 실패한 스텝들로 나타납니다):

```bash
npm run fixtures:init    # fixtures/mini-repo 생성 (또는 깨진 fixture 상태로 리셋)
npm run run -- fixtures/multi-charter.yaml --repo fixtures/mini-repo
# => scorecard: passed 2, escalated 0
```

(`fixtures/mini-repo`는 중첩 git 저장소라 이 저장소에 포함되지 않습니다 —
`npm run fixtures:init`이 로컬에서 생성하며, 다시 실행하면 깨진 fixture 상태로 리셋합니다.)

무슨 일이 있었는지 확인합니다:

```bash
./node_modules/.bin/tsx src/cli/index.ts status   # 최신 run, 사람이 읽기 좋은 리포트
npm run stats                                     # cross-run 수렴 텔레메트리
```

## 차터 포맷

차터는 YAML 파일입니다: 목표, 저장소 전체 scope, 범위가 지정된 항목들의 순서 있는 목록,
budget, 그리고 (선택적으로) verify 명령들로 구성됩니다.

```yaml
loopspec_version: "1.0"
name: fix-type-errors
readiness: L1
goal: "Fix TypeScript type errors, one file per item"
scope:
  include:
    - "src/**"
items:
  - id: fix-module-a
    description: "Fix the type errors in src/a.ts"
    scope:
      include: ["src/a.ts"]
budget:
  max_budget_usd: 2.00
  per_step_max_budget_usd: 0.50
  max_iterations: 6
  max_attempts_per_item: 2
  max_consecutive_failures: 2
verify:
  commands: []
denylist: []
```

- **`readiness: L1`** — `verify.commands`가 비어 있을 수 있습니다; 스텝의 scope가 깨끗하게
  유지되면 통과합니다.
- **`readiness: L2`** — `loopspec`은 각 스텝 이후 `verify.commands`를 실행합니다; 모든 명령이
  `0`으로 종료해야 합니다. 검증을 주장하면서 아무 명령도 제공하지 않는 `L2` 차터는 validator가
  거부합니다.

바로 가져다 쓸 수 있는 예제 4개가 [`seeds/`](seeds/)에 있습니다 (`fix-type-errors`,
`remove-dead-code`, `add-jsdoc`, `tsc-green`). 전체 필드 레퍼런스, 검증 규칙, 신뢰 모델은
[`spec/loopspec-1.0.md`](spec/loopspec-1.0.md)를 참고하세요.

## CLI 레퍼런스

| 명령 | 하는 일 |
|---|---|
| `loopspec init <name> [-f]` | 시작용 `<name>.charter.yaml` 스캐폴드 생성 |
| `loopspec validate <charter>` | Fail-closed 검증; 에러가 있으면 0이 아닌 종료 코드 |
| `loopspec status [name]` | 하나의 run에 대한 최신 run-log 렌더링 |
| `loopspec stats [name]` | 일치하는 **모든** run-log 집계 — cross-run 수렴 텔레메트리 |
| `loopspec install <source> [--registry <dir>] [--yes] [--force] [--report-only] [--dest <dir>]` | resolve → validate → scan → 동의 게이트 → 작성 + 신뢰 기록 |
| `loopspec run <charter> [+Nk] [-C, --repo <dir>] [--resume <runId>] [--yes] [--max-iter <n>] [--report-only] [--filter <ids>] [--agent <name>]` | 수렴형 스윕 실행 |

`run` 플래그:

- `+Nk` (예: `+50k`) — 이번 실행의 토큰 헤드룸. 유효 캡 = 이미 쓴 토큰 + N (input+output만,
  cache 토큰 제외). 차터의 `budget.max_tokens`를 이번 실행에 한해 덮어씁니다. USD가 안 잡히는
  구독 모드에서 실행을 바운드하는 주 수단.
- `--max-iter <n>` — 이번 실행의 iteration 헤드룸. `+Nk`와 같은 additive 모델: 유효 캡 =
  이미 돈 iteration + N (fresh run은 N, resume은 "N번 더").
- `--report-only` — 무엇이 실행될지(유효 캡, 항목 상태, 다음 항목)만 출력하고 아무것도
  실행/기록하지 않습니다.
- `--filter <ids>` — 콤마 구분 item id만 실행 (정확 매칭, 모르는 id는 거부). run-log에는
  필터된 실행 scope가 기록되므로 `status`/`stats`가 실제 실행과 일치합니다.
- `--agent <name>` — step을 구동할 어댑터 (기본 `claude-code`).

budget/iteration stop으로 끝난 run은 `--resume <runId>`에 `+Nk`나 `--max-iter`를 더해
캡을 올려 이어갈 수 있습니다 (resume은 연속 실패 스트릭도 리셋). 캡을 안 올려서 즉시
재중단될 resume은 로그를 건드리기 전에 거부됩니다. 종료 코드는 **수렴했을 때만 0** —
조기 중단으로 pending 항목이 남으면 1입니다.

(전역 설치(`npm install -g loopspec`)했다면 `loopspec <command>`를 그대로 쓰면 됩니다.
소스 체크아웃에서는 `validate`, `run`, `stats`에 `npm run` 스크립트가 있고
(예: `npm run validate -- <charter>`), 나머지 명령은 직접 호출하세요:
`./node_modules/.bin/tsx src/cli/index.ts <command> ...`.)

## 신뢰 및 보안 모델

`verify.commands`는 시스템 셸을 통해 실행되므로(`execa(cmd, { shell: true })`), 다른 사람의
차터를 설치하고 실행하는 것은 그 사람의 명령을 내 컴퓨터에서 실행하는 것과 같습니다. `loopspec`의
v1 신뢰 모델은 **스캔 + 명시적 동의**입니다 — 샌드박스가 아닙니다:

1. `loopspec install <source>`는 차터를 resolve하고, **검증**하고(fail-closed), `verify.commands`와
   모든 `scope.include`를 위험한 패턴에 대해 **스캔**한 뒤, 명령을 있는 그대로 그리고 findings와
   함께 출력합니다.
2. finding은 `danger` 또는 `warn`입니다. danger 규칙에는 pipe-to-shell, 인라인 인터프리터 eval
   (`node -e`, `python -c` 등), 스크립트 실행, 원격 fetch(`curl`/`wget`), 원격/raw-socket 셸,
   파괴적 삭제(`rm -rf`, `find -delete`), 디스크/디바이스 쓰기, fork bomb, 권한 상승(`sudo`,
   `chmod +s`), 난독화된 페이로드(`base64 -d`, `eval`), 시크릿 파일 접근(`.ssh/`,
   `.aws/credentials`), 전역 패키지 설치가 포함됩니다. warn 규칙은 로컬 설치, git-hook 하이재킹,
   파일 실행 권한 부여, 저장소 밖 경로, `.env` 접근, 동적 명령 치환, 지나치게 넓은 scope
   (`**`, `.`, `/`)를 표시합니다.
3. `danger` 수준 finding이 하나라도 있는 차터는 `--yes`를 넘기지 않으면 거부됩니다;
   `--report-only`는 아무것도 쓰지 않고 스캔만 하고 출력합니다.
4. 동의하면, 차터의 내용 체크섬(단순히 이름이 아니라)이 `.loopspec/trust.json`에 기록됩니다 —
   내용이 달라지면 다시 동의를 요구합니다.
5. `loopspec run`은 시작 시 다시 스캔하고, 이미 동의되었거나 `--yes`가 주어지지 않는 한
   신뢰할 수 없는 `danger` 차터를 `preflight` 이전에 거부합니다.

**이 스캔은 휴리스틱이며, 안전성을 증명하지 않습니다.** 스캔이 깨끗하다고 해서 안전이 보장되지
않습니다 — false negative가 가능합니다. 샌드박스화된 verify 실행, 차터 서명, 공개 공유 차터
레지스트리는 이후 ship으로 미뤄져 있습니다 (로드맵 참고). 공유받은 차터는 신뢰할 수 없는 스크립트를
다루듯 취급하세요: 동의하기 전에 명령을 직접 읽어보세요.

## 아키텍처

```
cli/        명령 진입점 + 제어 루프  (I/O, git, spawn을 수행하는 유일한 레이어)
spec/       차터 스키마 타입 + fail-closed validator
core/       순수한 오케스트레이션 로직 (run-log, state, controller, budget, scope, prompt, stats, scan)
adapters/   LLM-CLI 경계 — 다른 에이전트 러너를 지원하려면 여기를 교체
```

의존성은 한 방향으로만 흐릅니다: `cli/*`는 `spec/*`, `core/*`, `adapters/*`에 의존합니다;
`core/*` 모듈은 순수하게 유지되어(I/O 없음) 독립적으로 유닛 테스트가 가능합니다;
`adapters/claude-code.ts`는 `claude` 관련 인자와 stream-JSON 파싱을 아는 유일한 파일입니다.

상태는 이벤트 소싱됩니다: 루프는 절대 상태 객체를 그 자리에서 변경하지 않고 —
`RunLogEvent`를 JSONL run-log에 추가하고 `deriveState(readEntries(logPath))`를 통해 전체
`RunState`를 다시 계산합니다. run-log가 단일 진실 공급원이며, 이 덕분에
중단된 run을 재개하는 것이 특별한 케이스가 아니라 그저 재생이 됩니다.

파일 단위 전체 설명은 [`AGENTS.md`](AGENTS.md)를 참고하세요.

## 테스트

```bash
npm test                              # vitest, 유닛 테스트 84개, 결정적
./node_modules/.bin/tsc --noEmit      # 타입체크
```

## 로드맵 / 프로젝트 현황

실제 커밋 순서 기준입니다 (번호와 달리 Ship 3가 Ship 2a보다 먼저 나갔습니다):

- **Ship 0 / 1 / 1.5 — 베이스라인** ✅ 차터 포맷 + fail-closed validator, 이벤트 소싱된 JSONL
  run-log, 순수 컨트롤러(`pick` / `attemptGuard` / `stopCheck` / `buildScorecard`), 스텝 단위
  scope containment와 denylist enforcement를 갖춘 claude-code adapter.
- **Ship 3 — stats & cross-run 텔레메트리** ✅ `stats`는 일치하는 모든 run-log를 집계합니다:
  수렴율, 항목 통과율, 통과 항목당 시도 횟수, scope/denylist enforcement
  횟수, 비용, 그리고 고질적인 병목 항목을 드러내는 worst-first per-item breakdown.
- **Ship 2a — install & 차터 신뢰** ✅ 스캔-후-동의 신뢰 모델
  (`install`, trust ledger, run-time 신뢰 게이트). 후속 리뷰에서 스캐너 커버리지 갭 여러 개를
  닫았습니다 (bare 인터프리터 eval, 스크립트 실행, 로컬 설치, raw-socket egress, git-hook
  하이재킹).
- **Ship 4 — CLI 패키징 & npm 배포** ✅ `tsc` 빌드(`tsconfig.build.json` → `dist/`),
  `bin`이 컴파일된 `dist/cli/index.js`를 가리키고, 런타임 의존성이 `dependencies`로
  분리되어 `npm install -g loopspec`으로 설치 가능합니다.
- **Ship 5 — run 플래그** ✅ `+Nk` 토큰 헤드룸(`budget.max_tokens` 신설 — 구독 모드
  USD 과소집계 갭의 보완), `--max-iter`, `--report-only`, `--filter`, `--agent`
  (어댑터 레지스트리). 어댑터 주입으로 풀 루프 통합 테스트가 처음으로 가능해졌습니다.
- **알려진 갭** — `run --repo`는 여전히 fixture 중심입니다(차터 레벨 repo 필드 없음); `claude`가
  `total_cost_usd`를 보고하지 않는 순수 구독 모드에서는 USD 예산 계산이 과소 집계됩니다
  (토큰 캡 `+Nk`/`max_tokens`로 보완 가능); `status`/`stats` 출력은 아직 plain-text뿐입니다.
- **Ship 2b (deferred)** — 원격 fetch를 지원하는 공개 공유 차터 레지스트리, 로컬 trust ledger를
  넘어서는 차터 서명/체크섬, 샌드박스화된 verify 실행.

## 기여하기

이 저장소는 AI 에이전트 인더루프(agent-in-the-loop) 워크플로우로 개발됩니다; 이를 안전하고 일관되게 유지하는 컨벤션
(순수 core 원칙, NodeNext에서의 `.js` import 확장자, fixture를 재생성하는 방법, 검증 체크리스트)은
[`AGENTS.md`](AGENTS.md)에 문서화되어 있습니다 — PR을 보내기 전에 읽어주세요.

## 라이선스

MIT — [`LICENSE`](LICENSE) 참고.
