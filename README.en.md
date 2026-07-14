**English** | [한국어](README.md)

# loopspec

**Convergent sweep engine for bounded, auditable LLM automation.**

![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)
![tests: 84 passing](https://img.shields.io/badge/tests-84%20passing-brightgreen.svg)

`loopspec` takes a YAML **charter** — a goal broken into scoped items — and
drives a bounded control loop that spawns `claude -p` steps to fix each item,
mechanically enforces that each step only edits the files it was scoped to,
optionally runs verify commands, and records every decision to an append-only
run-log. The loop converges to a scorecard (`passed` / `failed` / `escalated`)
under explicit budget, attempt, and consecutive-failure limits.

## Why

Giving an LLM broad edit access and hoping it stays on task doesn't scale past
a handful of files — it drifts, over-edits, or silently "verifies" its own
work. `loopspec` inverts that: the **orchestrator**, not the model, owns
convergence and stopping.

- The model only ever sees one scoped item at a time, with `--allowedTools
  Read,Edit` and no ability to self-verify.
- After every step, `loopspec` diffs the target repo's working tree
  before/after and asserts the newly-changed files are a subset of that
  item's declared scope. A violation rolls back just that step and escalates
  the item — earlier passed items are untouched.
- Every decision (attempt started, scope violated, item escalated, run
  completed, ...) is one JSONL line in an append-only run-log. The run state
  is never mutated in place — it's always re-derived by replaying the log,
  which is what makes `loopspec run --resume <runId>` possible.
- A charter carries executable shell in `verify.commands`. Sharing charters is
  therefore a real injection vector, so `loopspec install` scans for dangerous
  patterns and requires explicit consent before writing or running anything
  untrusted (details below).

## Install

```bash
npm install -g loopspec
loopspec --version
loopspec init my-sweep   # scaffold a starter charter
```

## Quick start (from source)

The steps below use the repo's bundled fixtures, so they assume a source checkout:

```bash
git clone https://github.com/rhc98/loopspec.git
cd loopspec
npm install
npm test                 # 84 unit tests, deterministic, no network
```

Validate a charter (fail-closed — a non-zero exit means don't run it):

```bash
npm run validate -- fixtures/multi-charter.yaml
# ✓ fixtures/multi-charter.yaml is valid

npm run validate -- fixtures/mini-charter.yaml
# ✗ fixtures/mini-charter.yaml has 2 error(s):
#   [loopspec_version] loopspec_version is required (non-empty string)
#   [items] items must be a non-empty array
```

Run the convergent sweep over the bundled fixture target (needs a **logged-in**
`claude` CLI — subscription keychain or `CLAUDE_CODE_OAUTH_TOKEN` /
`ANTHROPIC_API_KEY`; `preflight` only checks the binary exists, so a
not-logged-in CLI surfaces as failed steps, not a startup error):

```bash
npm run fixtures:init    # create fixtures/mini-repo (or reset it to its broken state)
npm run run -- fixtures/multi-charter.yaml --repo fixtures/mini-repo
# => scorecard: passed 2, escalated 0
```

(`fixtures/mini-repo` is a nested git repo, so it does not ship with this
repository — `npm run fixtures:init` creates it locally, and re-running it
resets the fixture back to its broken state.)

Then inspect what happened:

```bash
./node_modules/.bin/tsx src/cli/index.ts status   # latest run, human report
npm run stats                                     # cross-run convergence telemetry
```

## Charter format

A charter is a YAML file: a goal, a repo-wide scope, an ordered list of
scoped items, a budget, and (optionally) verify commands.

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

- **`readiness: L1`** — `verify.commands` may be empty; a step passes when its
  scope stays clean.
- **`readiness: L2`** — `loopspec` runs `verify.commands` after each step;
  every command must exit `0`. The validator rejects an `L2` charter with no
  verify commands (a charter that claims verification but provides none).

Four ready-to-adapt examples live in [`seeds/`](seeds/) (`fix-type-errors`,
`remove-dead-code`, `add-jsdoc`, `tsc-green`). Full field reference, validation
rules, and the trust model: [`spec/loopspec-1.0.md`](spec/loopspec-1.0.md).

## CLI reference

| Command | What it does |
|---|---|
| `loopspec init <name> [-f]` | Scaffold a starter `<name>.charter.yaml` |
| `loopspec validate <charter>` | Fail-closed validation; non-zero exit on any error |
| `loopspec status [name]` | Render the latest run-log for one run |
| `loopspec stats [name]` | Aggregate **all** matching run-logs — cross-run convergence telemetry |
| `loopspec install <source> [--registry <dir>] [--yes] [--force] [--report-only] [--dest <dir>]` | Resolve → validate → scan → consent gate → write + record trust |
| `loopspec run <charter> [+Nk] [-C, --repo <dir>] [--resume <runId>] [--yes] [--max-iter <n>] [--report-only] [--filter <ids>] [--agent <name>]` | Run the convergent sweep |

`run` flags:

- `+Nk` (e.g. `+50k`) — token headroom for this invocation. Effective cap =
  tokens already spent + N (input+output only, cache tokens excluded). Overrides
  the charter's `budget.max_tokens` for this invocation. The main way to bound a
  run in subscription mode where USD is not reported.
- `--max-iter <n>` — override `budget.max_iterations` for this invocation
  (useful for raising the cap on resume).
- `--report-only` — print what would run (effective caps, item statuses, next
  item) and execute nothing, write nothing.
- `--filter <ids>` — run only the comma-separated item ids (exact match;
  unknown ids are refused).
- `--agent <name>` — adapter that drives steps (default `claude-code`).

A run that stopped on budget/iterations can be continued past the old cap with
`--resume <runId>` plus a fresh `+Nk` or `--max-iter`.

(With a global install (`npm install -g loopspec`), just use `loopspec
<command>` directly. In a source checkout, `validate`, `run`, and `stats` have
`npm run` scripts (e.g. `npm run validate -- <charter>`); call the other
commands directly: `./node_modules/.bin/tsx src/cli/index.ts <command> ...`.)

## Trust & security model

`verify.commands` runs through the system shell (`execa(cmd, { shell: true
})`), so installing and running someone else's charter runs their commands on
your machine. `loopspec`'s v1 trust model is **scan + explicit consent** — not
a sandbox:

1. `loopspec install <source>` resolves the charter, **validates** it
   (fail-closed), then **scans** `verify.commands` and every `scope.include`
   for dangerous patterns and prints the commands verbatim plus the findings.
2. Findings are `danger` or `warn`. Danger rules include pipe-to-shell,
   inline-interpreter eval (`node -e`, `python -c`, ...), script execution,
   remote fetch (`curl`/`wget`), remote/raw-socket shells, destructive delete
   (`rm -rf`, `find -delete`), disk/device writes, fork bombs, privilege
   escalation (`sudo`, `chmod +s`), obfuscated payloads (`base64 -d`, `eval`),
   secret-file access (`.ssh/`, `.aws/credentials`), and global package
   installs. Warn rules flag local installs, git-hook hijacking, making files
   executable, paths outside the repo, `.env` access, dynamic command
   substitution, and overly-broad scope (`**`, `.`, `/`).
3. A charter with any `danger`-level finding is refused unless you pass
   `--yes`; `--report-only` scans and prints without writing anything.
4. On consent, the charter's content checksum (not just its name) is recorded
   in `.loopspec/trust.json` — different content re-triggers consent.
5. `loopspec run` re-scans on start and refuses an untrusted `danger` charter
   before `preflight`, unless it's already consented or `--yes` is given.

**The scan is heuristic, not a safety proof.** A clean scan does not guarantee
safety — false negatives are possible. Sandboxed verify execution, charter
signing, and a public shared-charter registry are deferred to a later ship
(see Roadmap). Treat a shared charter like any untrusted script: read the
commands before consenting.

## Architecture

```
cli/        command entrypoints + control loop  (the only layer doing I/O, git, spawn)
spec/       charter schema types + fail-closed validator
core/       pure orchestration logic (run-log, state, controller, budget, scope, prompt, stats, scan)
adapters/   LLM-CLI boundary — swap here to support another agent runner
```

Dependencies flow one direction: `cli/*` depends on `spec/*`, `core/*`, and
`adapters/*`; `core/*` modules stay pure (no I/O) so they're unit-testable in
isolation; `adapters/claude-code.ts` is the only file that knows about
`claude`-specific args and stream-JSON parsing.

State is event-sourced: the loop never mutates a state object in place — it
appends a `RunLogEvent` to the JSONL run-log and re-derives the whole
`RunState` via `deriveState(readEntries(logPath))`. The run-log is the single
source of truth, which is what makes resuming an interrupted run a replay
rather than a special case.

Full file-by-file breakdown: [`AGENTS.md`](AGENTS.md).

## Testing

```bash
npm test                              # vitest, 84 unit tests, deterministic
./node_modules/.bin/tsc --noEmit      # typecheck
```

## Roadmap / project status

Shipped, in actual commit order (Ship 3 landed before Ship 2a, despite the
numbering):

- **Ship 0 / 1 / 1.5 — baseline** ✅ Charter format + fail-closed validator,
  event-sourced JSONL run-log, pure controller (`pick` / `attemptGuard` /
  `stopCheck` / `buildScorecard`), claude-code adapter with per-step scope
  containment and denylist enforcement.
- **Ship 3 — stats & cross-run telemetry** ✅ `stats` aggregates every matching
  run-log: convergence rate, item pass rate, attempts-per-passed-item,
  scope/denylist enforcement counts, cost, and a worst-first per-item
  breakdown for spotting chronic bottleneck items.
- **Ship 2a — install & charter trust** ✅ Scan-and-consent trust model
  (`install`, trust ledger, run-time trust gate). A follow-up review closed
  several scanner-coverage gaps (bare interpreter eval, script execution,
  local installs, raw-socket egress, git-hook hijacking).
- **Ship 4 — CLI packaging & npm release** ✅ `tsc` build
  (`tsconfig.build.json` → `dist/`), `bin` points at the compiled
  `dist/cli/index.js`, runtime deps moved to `dependencies`, installable via
  `npm install -g loopspec`.
- **Ship 5 — run flags** ✅ `+Nk` token headroom (new `budget.max_tokens` —
  compensates the subscription-mode USD under-count gap), `--max-iter`,
  `--report-only`, `--filter`, `--agent` (adapter registry). Adapter injection
  makes full-loop integration tests possible for the first time.
- **Known gaps** — `run --repo` is still fixture-oriented (no charter-level
  repo field); USD budget accounting under-counts when `claude` reports no
  `total_cost_usd` (pure subscription mode — the `+Nk`/`max_tokens` token cap
  compensates); `status`/`stats` output is plain-text only.
- **Ship 2b (deferred)** — a public shared-charter registry with remote
  fetch, charter signing/checksums beyond the local trust ledger, and
  sandboxed verify execution.

## Contributing

This repo is developed with an AI-agent-in-the-loop workflow; the conventions
that keep that safe and consistent (pure-core discipline, `.js` import
extensions under NodeNext, how to regenerate fixtures, validation checklist)
are documented in [`AGENTS.md`](AGENTS.md) — read it before sending a PR.

## License

MIT — see [`LICENSE`](LICENSE).
