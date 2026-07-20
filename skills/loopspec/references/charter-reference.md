# Charter reference

The authoritative spec is `spec/loopspec-1.0.md` in the loopspec repo. This file is the working subset you need to author a charter correctly.

## Complete annotated example

This is a full, valid charter — every field the engine actually uses.

```yaml charter
loopspec_version: "1.0"        # required by the validator
name: fix-type-errors          # run-log filename prefix — always emit
readiness: L1                  # L1 | L2 — always emit
goal: "Fix TypeScript type errors, one file per item"   # injected into every step prompt
scope:                         # repo-wide allow-list — always emit
  include:
    - "src/**"
items:                         # processed in array order
  - id: fix-module-a           # stable, appears in the run-log
    description: "Fix the type errors in src/a.ts without changing its public API"
    scope:
      include: ["src/a.ts"]    # the ONLY files this item's step may change
  - id: fix-module-b
    description: "Fix the type errors in src/b.ts without changing its public API"
    scope:
      include: ["src/b.ts"]
budget:
  max_budget_usd: 2.00         # $0 under a subscription — never rely on this alone
  per_step_max_budget_usd: 0.50  # advisory
  max_iterations: 6            # the cap that actually bounds the run
  max_attempts_per_item: 2     # retries before an item escalates
  max_consecutive_failures: 2  # consecutive failures before the whole run stops
verify:
  commands: []                 # L1 may be empty; L2 must not be
denylist: []                   # extra tool names blocked at the agent layer
```

## Fields

### Top level

| Field | Type | Required | Meaning |
|---|---|---|---|
| `loopspec_version` | string | **validator** | `"1.0"` today |
| `name` | string | *always emit* | charter name; run-log filename prefix |
| `readiness` | `L1` \| `L2` | *always emit* | verify strictness |
| `goal` | string | *always emit* | one line, injected into each step prompt |
| `scope.include` | string[] | *always emit* | repo-wide globs the charter may touch |
| `items` | Item[] | **validator** | units of work, in array order |
| `budget` | Budget | **validator** | convergence bounds |
| `verify.commands` | string[] | **validator** for L2 | deterministic checks after each step |
| `denylist` | string[] | no | tool names passed as `--disallowedTools` |

### Item

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | **validator** | stable identifier, used by `--filter` |
| `description` | string | **validator** | the scoped task, injected into the step prompt |
| `scope.include` | string[] | **validator** | the only files this item's step may change |

### Budget

| Field | Type | Required | Meaning |
|---|---|---|---|
| `max_iterations` | number | one of these two | hard cap on completed steps |
| `max_budget_usd` | number | one of these two | hard cap on *reported* spend |
| `max_tokens` | number | no | cap on `input + output` summed across steps; cache tokens excluded. `+Nk` overrides it per invocation |
| `per_step_max_budget_usd` | number | no | advisory only |
| `max_attempts_per_item` | number | engine | retries before escalation |
| `max_consecutive_failures` | number | engine | consecutive failures before the run stops |

## Validation rules (fail-closed)

`loopspec validate` returns `{rule, message}[]`; a non-empty list aborts before any step runs.

1. **`loopspec_version`** — present, non-empty string.
2. **`budget`** — a mapping with at least one of `max_budget_usd` or `max_iterations` as a number. If `max_tokens` is present it must be finite and `> 0`.
3. **`verify`** — if `readiness: L2`, `verify.commands` must be a non-empty string array.
4. **`items`** — non-empty array; every item has a non-empty `id`, `description`, and `scope.include`.

## Always emit — even though the validator does not check

The validator does **not** require `name`, `goal`, `readiness`, or top-level `scope`, though the spec marks all four required. Each omission fails somewhere else, later and less legibly:

| Omitted | What actually happens |
|---|---|
| `name` | the run-log is written to `undefined-<uuid>.jsonl` |
| `scope` (top level) | `loopspec install` throws an uncaught TypeError |
| `readiness` | L2 verify enforcement is silently skipped — the charter claims verification and performs none |
| `goal` | steps run with an empty goal line in the prompt |

## Never emit

These are deferred in v1.0. **The validator silently ignores unknown fields, so a charter containing them passes `validate` and then does nothing with them** — which is worse than a rejection, because it reads as configured behavior that never happens.

- `depends_on` (item ordering — items run in array order, period)
- per-item `budget` overrides
- retry / backoff policy
- `verify.env_from`
- `parameters`
- `engine` / `model` selectors

If the user asks for any of these, say it is not supported and express the intent another way — item ordering via array position, budget via the single top-level `budget`.

## L1 vs L2

- **L1** — `verify.commands` may be empty. A step passes when the agent did not error and the scope stayed clean. Use when correctness is checked separately (review, a later test run).
- **L2** — loopspec runs `verify.commands` in the target repo after each clean step; every command must exit 0 for the step to pass. The validator **requires** a non-empty `verify.commands` for L2.

Pick L2 whenever a deterministic check exists. It is the difference between "the agent edited the file" and "the file is correct."

## Budget sizing

- `max_iterations` ≈ items × `max_attempts_per_item`. This is the cap that actually bounds the run.
- `max_attempts_per_item`: 2 for L1, 3 for L2 (verify failures are informative and worth retrying).
- `max_consecutive_failures`: 2–3. This is the circuit breaker for a systemic problem — logged-out `claude`, a verify command that cannot pass — and it should trip well before `max_iterations`.
- `max_budget_usd`: set it as a backstop, but treat it as decorative. Under a Claude subscription the reported spend is `$0`, so it never trips.
- CLI token headroom: **15–25k per item** via `+Nk`.

## Scope globs

Item scope is enforced by diffing the working tree before and after each step and asserting the newly-changed files are a subset of `scope.include`. Consequences:

- **Tight scope is a feature.** `["src/a.ts"]` means a step that wanders into `src/b.ts` is rolled back and escalated rather than silently accepted.
- **Broad globs** (`**`, `*`, `.`, `/`, `**/*`, `./**`, `./*`) trip a `broad-scope` WARN. Not blocking, but it defeats the point.
- An item whose real work spans files outside its scope will loop, escalate on `scope-violation`, and get rolled back every time. Split it or widen it — do not raise its attempts.
