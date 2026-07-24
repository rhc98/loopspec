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

1. `src/cli/index.ts` is the `commander` entrypoint exposing six subcommands:
   `init <name>`, `validate <charter>`, `status [name]`, `stats [name]`,
   `install <source>`, and `run <charter> [--repo <dir>] [--resume <runId>]`.
   `status` reads the latest run-log for one run; `stats` aggregates *all*
   matching run-logs for cross-run convergence telemetry; `install` scans a
   charter for dangerous shell and installs it only on explicit consent (and
   `run` refuses an untrusted charter with DANGER findings — see Trust below).
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
| `package.json` | npm scripts (`test`, `typecheck`, `fixtures:init`, `validate`, `run`, `spike`), deps, `bin` |
| `LICENSE` | MIT license |
| `README.md` / `README.en.md` | user-facing docs (Korean / English) |
| `skills/loopspec/` | Claude Code agent skill — `SKILL.md` workflow + `references/` (charter schema, run-log/troubleshooting, seeds); shipped via `.claude-plugin/marketplace.json`, guarded by `src/__tests__/skill.test.ts` |
| `scripts/init-fixtures.ts` | create/reset `fixtures/mini-repo` (`npm run fixtures:init`) |
| `tsconfig.json` | ES2022 + NodeNext, strict; includes `spike/`, `src/`, `src/__tests__/` |
| `src/cli/index.ts` | commander entry; `init` / `validate` / `status` / `stats` / `install` / `run` subcommands, exit codes |
| `src/cli/run.ts` | main control loop, trust gate, scope assert, git rollback, `--resume`, scorecard print |
| `src/cli/validate.ts` | `validate` command — loads YAML, runs validator, prints errors |
| `src/cli/init.ts` | `init` command — scaffolds `<name>.charter.yaml` from the template |
| `src/cli/status.ts` | `status` command — finds latest run-log, renders it |
| `src/cli/stats.ts` | `stats` command — reads all matching run-logs, cross-run aggregate |
| `src/cli/install.ts` | `install` command — resolve, validate, scan, consent gate, write + record trust |
| `src/cli/registry.ts` | resolve a charter source (local path or `--registry` ref) → raw + origin |
| `src/cli/trust-ledger.ts` | `.loopspec/trust.json` I/O — content-checksum consent records |
| `src/spec/template.ts` | `charterTemplate(name)` — starter charter for `init` |
| `src/core/status.ts` | pure `renderStatus(entries)` — run-log → human report |
| `src/core/stats.ts` | pure `computeStats` / `renderStats` — cross-run convergence telemetry |
| `src/core/scan.ts` | pure `scanCharter` / `hasDanger` / `renderFindings` — heuristic charter risk scan |
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
| `src/core/` | pure orchestration logic (run-log, state, controller, budget, scope, prompt, stats, scan) |
| `src/adapters/` | LLM-CLI boundary; swap here to support another agent runner |
| `src/__tests__/` | vitest unit tests (validator, controller, run-log, scope, parser) |
| `fixtures/` | charters, the `mini-repo` target, recorded transcripts |
| `seeds/` | adapt-and-run charter examples (kept valid by `seeds.test.ts`) |
| `spec/` | `loopspec-1.0.md` charter format reference |
| `scripts/` | repo maintenance scripts (`init-fixtures.ts`) |
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
  needs a git target). It is gitignored by the parent repo — create or reset it
  with `npm run fixtures:init` (`scripts/init-fixtures.ts`); its `HEAD`
  intentionally holds the broken `a.ts` / `b.ts`.
- Docs in prose are Korean-friendly; **code, identifiers, and commits are English**.
- The repo root and `fixtures/mini-repo` are **separate git repos**; never run
  git commands for one against the other.

### Validation Checklist

- `npm run typecheck` — `tsc --noEmit` over `src/`, `scripts/`, `spike/`.
- `npm test` — vitest unit suite (deterministic; no network).
- `./node_modules/.bin/tsx src/cli/index.ts validate fixtures/multi-charter.yaml` — expect valid (exit 0).
- `./node_modules/.bin/tsx src/cli/index.ts validate fixtures/mini-charter.yaml` — expect invalid (exit 1).
- Live E2E (needs a logged-in `claude`):
  `npm run fixtures:init && ./node_modules/.bin/tsx src/cli/index.ts run fixtures/multi-charter.yaml --repo fixtures/mini-repo`
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
- `tsx` — TypeScript runner (dev only; the shipped `bin` is compiled JS).
- `vitest` — ESM-native unit tests.
- `typescript` — typecheck (`tsc --noEmit`, root tsconfig covers the full tree)
  and build (`npm run build` → `tsc -p tsconfig.build.json`, emits `src/` minus
  `__tests__` to `dist/`; `bin` points at `dist/cli/index.js`). Runtime deps
  (`commander`, `execa`, `js-yaml`) live in `dependencies`; everything else is dev.

## Known Gaps

- `run --repo` defaults to `process.cwd()`; the engine is still fixture-oriented
  (no charter-level repo field).
- Budget accounting only sees `total_cost_usd` when claude reports it; in pure
  subscription mode cost may be absent, so USD budgets can under-count.
- `fixtures/transcripts/run2.stream-json` is assembled from real spike run-2
  usage numbers, not captured live (see `fixtures/transcripts/README.md`).
- `status` is plain-text; a richer ink TUI is intentionally deferred.
- `loopspec.schema.json` (polished JSON schema) not written yet; `spec/loopspec-1.0.md`
  is the current format reference.
- Trust model is **scan + explicit consent** (Ship 2a). The scanner
  (`src/core/scan.ts`) is heuristic — a clean scan is *not* a safety proof.
  Deferred to Ship 2b: the public `awesome-loops` repo + remote fetch, and
  charter signing/checksums; sandboxed verify execution is deferred further.
- `run` flags shipped in 0.2.0: `+Nk` and `--max-iter` (both additive headroom;
  effective cap = amount already spent + N — tokens count input+output only),
  `--report-only` (plan print, zero side effects), `--filter` (exact item-id
  subset; `run-started` records the *effective* item list so replay/stats agree
  with what ran, and `deriveState` tracks ids missing from `run-started` lazily
  for widened-filter resumes), `--agent` (adapter registry in
  `src/adapters/registry.ts`; only `claude-code` registered). CLI overrides are
  folded into an *effective charter* by the pure `applyOverrides`
  (`src/core/overrides.ts`, single fail-closed `errors` channel) — controller
  signatures unchanged. `RunOptions.adapter` is a test seam that injects a mock
  adapter, enabling full-loop integration tests (`src/__tests__/run-loop.test.ts`).
  Resume semantics: `run-resumed` flips derived status back to `running` AND
  resets the consecutive-failure streak (operator intervention); the "already
  completed" early-return only fires when all effective items are terminal; a
  resume that would immediately re-stop is refused before any log write. Exit
  code is 0 only on convergence (`passed === total`).

<!-- MANUAL: Add long-term project notes below this line. -->
