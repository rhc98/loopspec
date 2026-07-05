<!-- Generated: 2026-06-29 -->

# loopspec Project Context (Root)

## Purpose

loopspec is a Node + TypeScript **convergent sweep engine**. Given a *charter*
(a YAML goal broken into scoped items), it drives a bounded control loop that
spawns `claude -p` steps to fix each item, mechanically enforces that each step
edits only its allowed files, optionally runs verify commands, and records every
decision to an append-only JSONL run-log. The loop converges to a scorecard
(passed / failed / escalated) under explicit budget, attempt, and
consecutive-failure limits.

The core idea, validated in the Ship 0 spike: an `--allowedTools Read,Edit`
whitelist + a no-self-verify prompt keeps each LLM step inside its scope and
small, so the orchestrator — not the model — owns convergence and stopping.

## System Overview

1. `src/cli/index.ts` is the `commander` entrypoint exposing five subcommands:
   `init <name>`, `validate <charter>`, `status [name]`, `stats [name]`, and
   `run <charter> [--repo <dir>] [--resume <runId>]`. `status` reads the latest
   run-log for one run; `stats` aggregates *all* matching run-logs for cross-run
   convergence telemetry.
2. `src/cli/run.ts` is the control loop. It runs `preflight()`, loads + validates
   the charter (fail-closed), assigns a `run_id`, and writes a `.loopspec/runs/<name>-<run_id>.jsonl`
   log. Each iteration: `stopCheck` → `pick` → `attemptGuard` → `buildStepPrompt`
   → `runStep` → **per-step scope assert** → `runVerify` → append `attempt-completed`.
3. **State is event-sourced.** The loop never mutates a state object in place; it
   appends a `RunLogEvent` and re-derives the whole `RunState` via
   `deriveState(readEntries(logPath))`. The run-log is the single source of truth.
4. `src/core/controller.ts` holds the pure decision functions (`pick`,
   `attemptGuard`, `stopCheck`, `buildScorecard`). They take `(RunState, Charter)`
   and return decisions — no I/O.
5. `src/adapters/claude-code.ts` isolates the LLM CLI: `preflight()` (claude
   binary present), `runStep()` (execa spawn of `claude -p --output-format
   stream-json`), and the pure `parseStreamJson()` (NDJSON → `StepOutput`).
   The controller layer must never know claude-specific details.
6. Scope containment is enforced in code: `src/core/scope.ts` compares the git
   working-tree diff *before* vs *after* a step, so only files **this step**
   touched are checked against `item.scope.include`. A violation rolls back only
   that step's files (`git checkout HEAD -- <files>`) and escalates the item,
   preserving earlier passed items' changes.

## Key Files

| File | Description |
|---|---|
| `package.json` | npm scripts (`test`, `validate`, `run`, `spike`), deps, `bin` |
| `tsconfig.json` | ES2022 + NodeNext, strict; includes `spike/`, `src/`, `src/__tests__/` |
| `src/cli/index.ts` | commander entry; `init` / `validate` / `status` / `run` subcommands, exit codes |
| `src/cli/run.ts` | main control loop, scope assert, git rollback, `--resume`, scorecard print |
| `src/cli/validate.ts` | `validate` command — loads YAML, runs validator, prints errors |
| `src/cli/init.ts` | `init` command — scaffolds `<name>.charter.yaml` from the template |
| `src/cli/status.ts` | `status` command — finds latest run-log, renders it |
| `src/cli/stats.ts` | `stats` command — reads all matching run-logs, cross-run aggregate |
| `src/spec/template.ts` | `charterTemplate(name)` — starter charter for `init` |
| `src/core/status.ts` | pure `renderStatus(entries)` — run-log → human report |
| `src/core/stats.ts` | pure `computeStats` / `renderStats` — cross-run convergence telemetry |
| `src/spec/types.ts` | `Charter` / `Item` / `Budget` / `Verify` interfaces |
| `src/spec/validator.ts` | fail-closed 4-rule charter validation → `ValidationError[]` |
| `src/core/run-log.ts` | append-only JSONL writer (`fsync` per row) + reader; `RunLogEvent` union, `SCHEMA_VERSION` |
| `src/core/state.ts` | `RunState` / `ItemState` / `Scorecard`; `deriveState()` pure replay |
| `src/core/controller.ts` | pure `pick` / `attemptGuard` / `stopCheck` / `buildScorecard` |
| `src/core/budget.ts` | `accountUsage()` / `budgetExceeded()` cost accounting |
| `src/core/scope.ts` | pure `stepChangedFiles()` / `scopeViolations()` (before/after baseline) |
| `src/core/prompt.ts` | `buildStepPrompt()` — scope-locked, no-self-verify step prompt |
| `src/adapters/types.ts` | `Usage` / `StepInput` / `StepOutput` adapter-boundary types |
| `src/adapters/claude-code.ts` | `preflight` / `runStep` / `parseStreamJson` / `countBashCalls` |
| `fixtures/multi-charter.yaml` | Ship 1 charter (2 items, `loopspec_version`) |
| `fixtures/mini-charter.yaml` | Ship 0 charter (legacy; intentionally invalid under Ship 1 rules) |
| `fixtures/mini-repo/` | nested git repo target (`src/a.ts` type error, `src/b.ts` unused var) |
| `fixtures/transcripts/run2.stream-json` | deterministic replay fixture for the parser test |
| `spike/run.ts` | Ship 0 spike (kept for reference; not part of the engine) |

## Subdirectories

| Directory | Purpose |
|---|---|
| `src/cli/` | command entrypoints + control loop (only layer that does process I/O / git / spawn) |
| `src/spec/` | charter schema types + fail-closed validator |
| `src/core/` | pure orchestration logic (run-log, state, controller, budget, scope, prompt, stats) |
| `src/adapters/` | LLM-CLI boundary; swap here to support another agent runner |
| `src/__tests__/` | vitest unit tests (validator, controller, run-log, scope, parser) |
| `fixtures/` | charters, the `mini-repo` target, recorded transcripts |
| `seeds/` | adapt-and-run charter examples (kept valid by `seeds.test.ts`) |
| `spec/` | `loopspec-1.0.md` charter format reference |
| `spike/` | Ship 0 throwaway spike + `results.jsonl` (reference only) |
| `.loopspec/runs/` | runtime run-logs (gitignored) |

## For AI Agents

### Working In This Repository

- **NodeNext imports require `.js` extensions** on every relative import
  (`import { x } from "./state.js"`), even though the files are `.ts`. Omitting
  the extension breaks `tsx`/Node ESM resolution.
- **`npx` is rewritten by a shell hook (RTK)** and fails (`Missing script: tsx`).
  Use `npm run <script>` or call the binary directly:
  `./node_modules/.bin/tsx`, `./node_modules/.bin/vitest`, `./node_modules/.bin/tsc`.
- **Never mutate `RunState` in the loop.** Add a new `RunLogEvent` variant +
  handle it in `deriveState`, then re-derive. Keep `src/core/*` pure and
  side-effect free — that is what makes them unit-testable.
- **Keep the validator fail-closed.** New charter constraints are new rules in
  `validator.ts` returning `ValidationError[]`; the caller exits non-zero on any.
- **Keep the adapter boundary clean.** claude-specific args/parsing live only in
  `src/adapters/claude-code.ts`. `src/core/*` and the loop talk in
  `StepInput`/`StepOutput`.
- **Scope assert must stay per-step** (before/after diff), not cumulative
  `git diff HEAD` — a cumulative check falsely flags earlier passed items'
  changes once there is more than one item. Rollback must target only this
  step's files, never `git checkout HEAD -- .`.
- **`fixtures/mini-repo` is a real nested git repo on purpose** (the scope check
  needs a git target). Reset it between runs with
  `git -C fixtures/mini-repo checkout HEAD -- .`; its `HEAD` intentionally holds
  the broken `a.ts` / `b.ts`.
- Docs in prose are Korean-friendly; **code, identifiers, and commits are English**.
- The repo root is **not yet a git repo**; only `fixtures/mini-repo` is.

### Validation Checklist

- `./node_modules/.bin/tsc --noEmit` — typecheck (no root `typecheck` script yet).
- `npm test` — vitest unit suite (deterministic; no network).
- `./node_modules/.bin/tsx src/cli/index.ts validate fixtures/multi-charter.yaml` — expect valid (exit 0).
- `./node_modules/.bin/tsx src/cli/index.ts validate fixtures/mini-charter.yaml` — expect invalid (exit 1).
- Live E2E (needs a logged-in `claude`):
  `git -C fixtures/mini-repo checkout HEAD -- . && ./node_modules/.bin/tsx src/cli/index.ts run fixtures/multi-charter.yaml --repo fixtures/mini-repo`
  — expect scorecard `passed: 2, escalated: 0`.

### Operational Assumptions

- `run` spawns the real `claude` CLI; it must be **logged in** (subscription
  keychain or `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`). `preflight()`
  only checks the binary exists, so a not-logged-in CLI surfaces as steps that
  return `is_error` → `outcome: fail`, not as a preflight throw.
- In this dev machine's non-interactive Bash shell the CLI is currently **not
  logged in**; live `run` and re-recording transcripts must be done from a
  logged-in terminal. Deterministic checks (tsc, vitest, validate) run anywhere.
- Run-logs are written under the invocation cwd's `.loopspec/runs/`, not inside
  the target repo.
- Charter readiness `L1` allows empty `verify.commands` (outcome is pass when
  scope is clean); `L2` requires non-empty verify commands.

## Dependencies

### Internal (layering, one direction)

- `cli/*` → `spec/*`, `core/*`, `adapters/*` (the only layer doing I/O, git, spawn).
- `core/state` → `core/run-log` (types), `core/budget` (`accountUsage`).
- `core/controller` → `core/state`, `core/budget`, `spec/types`.
- `core/scope`, `core/prompt`, `core/budget` are leaf modules (no core deps beyond types).
- `adapters/claude-code` → `adapters/types` only; never imports `core/*`.

### External

- `commander` — CLI parsing.
- `execa` — spawning `claude` and `git`.
- `js-yaml` — charter parsing.
- `tsx` — TypeScript runner (dev + bin).
- `vitest` — ESM-native unit tests.
- `typescript` — typecheck only (no build step shipped yet).

## Known Gaps

- No `git init` at the repo root yet; nothing is under version control or pushed.
- No root `typecheck`/`build` scripts and no compiled `dist/`; `bin` points at the
  `.ts` entry and relies on `tsx`.
- `run --repo` defaults to `process.cwd()`; the engine is still fixture-oriented
  (no charter-level repo field).
- Budget accounting only sees `total_cost_usd` when claude reports it; in pure
  subscription mode cost may be absent, so USD budgets can under-count.
- `fixtures/transcripts/run2.stream-json` is assembled from real spike run-2
  usage numbers, not captured live (see `fixtures/transcripts/README.md`).
- `status` is plain-text; a richer ink TUI is intentionally deferred.
- `loopspec.schema.json` (polished JSON schema) not written yet; `spec/loopspec-1.0.md`
  is the current format reference.
- Out of scope for now: `loopspec install` + `awesome-loops` (Ship 2)
  and `run` flags `+Nk` / `--max-iter` / `--report-only` / `--filter` / `--agent`.

<!-- MANUAL: Add long-term project notes below this line. -->
