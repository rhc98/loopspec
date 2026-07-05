# loopspec charter format — v1.0

A **charter** is a YAML file that declares a convergent goal, breaks it into
scoped **items**, and bounds the work with a **budget**. `loopspec run` drives a
deterministic control loop over the charter: it picks an item, runs one scoped
`claude -p` step, asserts the step stayed inside the item's scope, optionally
runs verify commands, records the outcome to an append-only run-log, and repeats
until every item is terminal or a stop condition trips.

This document specifies the v1.0 charter shape. The validator
(`src/spec/validator.ts`) enforces the **fail-closed rules** below; anything it
rejects causes a non-zero exit before any step runs.

## Example

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

More examples live in [`seeds/`](../seeds/).

## Top-level fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `loopspec_version` | string | **yes** | charter format version; `"1.0"` today |
| `name` | string | yes | charter name; also the run-log filename prefix |
| `readiness` | `"L1"` \| `"L2"` | yes | verify strictness (see below) |
| `goal` | string | yes | one-line description, injected into each step prompt |
| `scope.include` | string[] | yes | repo-wide file globs the charter is allowed to touch |
| `items` | Item[] | **yes** | the units of work, processed in array order |
| `budget` | Budget | **yes** | convergence bounds (see below) |
| `verify.commands` | string[] | L2: **yes** | deterministic checks run after each step |
| `denylist` | string[] | no | extra tool names blocked at the agent layer |

### Item

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | **yes** | stable identifier; appears in the run-log |
| `description` | string | **yes** | the scoped task, injected into the step prompt |
| `scope.include` | string[] | **yes** | the only files this item's step may change |

### Budget

| Field | Type | Required | Meaning |
|---|---|---|---|
| `max_iterations` | number | one of these two | hard cap on completed step count |
| `max_budget_usd` | number | one of these two | hard cap on reported spend (USD) |
| `per_step_max_budget_usd` | number | no | advisory per-step cap |
| `max_attempts_per_item` | number | yes (engine) | retries before an item escalates |
| `max_consecutive_failures` | number | yes (engine) | consecutive failures before the run stops |

## Readiness: L1 vs L2

- **L1** — `verify.commands` may be empty. A step's outcome is `pass` when the
  agent did not error and the scope stayed clean. Use for changes whose
  correctness you will check separately.
- **L2** — loopspec runs `verify.commands` (in `--repo`) after each clean step;
  every command must exit `0` for the step to `pass`. The validator **requires a
  non-empty `verify.commands`** for L2 — a charter that claims verification but
  provides none is rejected.

## Fail-closed validation rules

The validator returns a list of `{ rule, message }`; a non-empty list aborts the
run. The four rules:

1. **`loopspec_version`** — present and a non-empty string.
2. **`budget`** — a mapping with at least one of `max_budget_usd` or
   `max_iterations` as a number (the run must be bounded somehow).
3. **`verify`** — if `readiness: L2`, `verify.commands` must be a non-empty
   string array.
4. **`items`** — a non-empty array; every item has a non-empty `id`,
   `description`, and `scope.include` (non-empty string array).

## How `run` uses the charter

- **Scope enforcement** — after each step, loopspec diffs the target repo's
  working tree (before vs after the step) and asserts the newly-changed files are
  a subset of the item's `scope.include`. A violation rolls back only that step's
  files and **escalates** the item.
- **Denylist** — `denylist` entries are passed to the agent as
  `--disallowedTools`, on top of the fixed `Read,Edit` allow-list. Any blocked
  calls reported by the agent are recorded as a `denylist-blocked` audit event.
- **Budget / attempts / stop** — the loop stops when all items are terminal
  (`pass`/`escalated`), `max_budget_usd` is exceeded, `max_iterations` is hit, or
  `max_consecutive_failures` consecutive failures occur. An item that fails up to
  `max_attempts_per_item` times then escalates.
- **State** — every decision is an append-only JSONL run-log entry (one
  `schema_version` per row); the run state is always re-derived from that log, so
  `loopspec run --resume <run_id>` continues an interrupted run by replay.

## Trust & sharing

A charter carries **executable shell** in `verify.commands`, which `run` executes
verbatim through the system shell. Installing and running someone else's charter
therefore runs their commands on your machine — a real injection vector.

loopspec's v1 trust model is **scan + explicit consent** (not a sandbox):

- `loopspec install <source>` resolves a charter, **validates** it (fail-closed),
  then **scans** `verify.commands` and `scope.include` for dangerous patterns
  (pipe-to-shell, remote fetch, `rm -rf`, privilege escalation, secret access,
  obfuscated payloads, overly broad scope). It prints the commands verbatim plus
  the findings and installs only on consent. A charter with **DANGER**-level
  findings is refused unless you pass `--yes`. `--report-only` scans without writing.
- On consent the charter's content checksum is recorded in `.loopspec/trust.json`.
  `loopspec run` re-scans on start and **refuses an untrusted charter with DANGER
  findings** unless it is consented (or `--yes` is given).

**The scan is heuristic, not a safety proof** — a clean scan does not guarantee
safety (false negatives are possible). Sandboxed verify execution and charter
signing are deferred. Treat a shared charter like any untrusted script: read the
commands before consenting.

## Version compatibility (intended contract)

`loopspec_version` is `major.minor`. The intended back-compat policy:

- An **older minor** of the same major is accepted.
- An **unknown _required_** field is rejected (fail-closed).
- An **unknown _optional_** field is ignored.

The v1.0 validator implements the minimal rule set above; the broader
required/optional distinction is the contract future versions will hold to.

## Deferred (not in v1.0)

Per-item `budget` overrides, `depends_on` ordering, retry/backoff with
transient-vs-logic classification, `verify.env_from`, reusable `parameters`,
and `engine`/`model` selectors are planned but not part of the v1.0 validated
surface yet.
