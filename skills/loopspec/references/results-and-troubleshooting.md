# Results and troubleshooting

## The run-log

`.loopspec/runs/<name>-<runId>.jsonl`, append-only, one JSON object per line, fsynced per row so it survives a crash. Run state is always re-derived from this log — that is what makes `--resume` a replay rather than a guess.

Every row has the same envelope:

```json
{ "schema_version": 1, "ts": "2026-07-20T13:20:38.610Z", "run_id": "<uuid>", "event": { "type": "...", ... } }
```

### Events

| `event.type` | Payload | Means |
|---|---|---|
| `run-started` | `charter`, `run_id`, `items[]` | the run began; `items` is the effective (post-`--filter`) list |
| `run-resumed` | — | `--resume` picked up an existing log |
| `attempt-started` | `item_id`, `attempt` | a step is about to run |
| `scope-violated` | `item_id`, `files[]` | the step changed files outside the item's scope; those files were rolled back |
| `denylist-blocked` | `item_id`, `tools[]` | the agent tried a denylisted tool |
| `attempt-completed` | `item_id`, `attempt`, `outcome`, `usage?` | outcome is `pass` \| `fail` \| `escalated` |
| `item-escalated` | `item_id`, `reason` | reason is **only** `max_attempts` or `scope-violation` |
| `run-completed` | `scorecard` | terminal row |

`usage` is `{ input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, total_cost_usd? }`.

### Deriving answers from the log

- **Which items failed** — last `attempt-completed` per `item_id`, plus every `item-escalated`.
- **Token spend** — sum `input_tokens + output_tokens` across `attempt-completed.usage`. Cache tokens are excluded from the budget accounting.
- **Why the run stopped** — not recorded directly. Infer it: all items terminal → done; `iterations` equal to `max_iterations` → iteration cap; token total at the cap → budget stop; N trailing `fail` outcomes → consecutive-failure breaker.

### What the log does NOT contain

Be honest about this instead of inventing a cause:

- **`attempt-completed` carries no error text.** A `fail` outcome tells you the step did not pass. It does not tell you whether the agent errored, the verify command failed, or the model produced nothing.
- **`item-escalated.reason` is one of two strings.** `max_attempts` is a catch-all — it means "ran out of retries", not a diagnosis.

When the reason matters, reproduce it live: run the verify command by hand, check `claude` auth, re-read the item's scope.

## Reading the scorecard

```
=== scorecard ===
  total:     3
  passed:    2
  failed:    0
  escalated: 1
  iterations:5
  spent_usd: $0
  tokens:    41230
```

- `spent_usd: $0` is normal on a subscription. It is not evidence the run was free.
- `escalated` is the number that matters — those items need a human decision.
- `iterations` at the charter's `max_iterations` means the cap stopped the run, not convergence.
- Exit code is `passed === total ? 0 : 1`. It does not distinguish stop reasons.

`loopspec status` and `loopspec stats` render this for a human, but **only from the cwd the run used** — they resolve `.loopspec/runs` against `process.cwd()`.

## Failure playbook

### Every step fails immediately, near-zero tokens

**`claude` is logged out.** loopspec's preflight only runs `claude --version`, so a logged-out CLI passes preflight and every step then fails with nothing useful in the log.

Fix: have the user log in, then `--resume <fullRunId> +Nk`. Confirm auth before spending more budget.

### `scope-violation` escalation

The step edited files outside the item's `scope.include`. loopspec rolled back that step's files and escalated the item — no damage, but no progress.

Fix: the scope is wrong, not the agent. Either widen `scope.include` to the files the work genuinely needs, or split the item so each piece stays inside a tight scope. Then `--filter <ids>` to retry just those. Do not raise `max_attempts_per_item` — it will violate again.

### `max_attempts` escalation

Ran out of retries with no recorded reason. Diagnose in this order:

1. Is `claude` logged in?
2. For L2 — does `verify.commands` pass when you run it by hand in the target repo? A verify command that cannot pass makes every step fail forever.
3. Is the item too big for one `Read,Edit` step with 5 turns? Split it.
4. Is the description specific enough to act on without exploration? The agent cannot search — it has `Read` and `Edit` only.

### Budget or iteration stop

Non-terminal items remain. Resume with more headroom:

```
loopspec run <charter> --resume <fullRunId> +50k
```

### `✗ resume would make no progress: <reason>`

You resumed without raising the cap that stopped the run, so the first check would stop it again. loopspec refuses before touching the log.

Add `+Nk` (tokens) or `--max-iter <n>` (iterations) — both are **additive over spend-at-start**. For `max_budget_usd` there is no CLI override; edit the charter, and note that re-editing invalidates any recorded trust consent.

### `✗ no run-log to resume at <path>`

You passed the 8-character banner prefix instead of the full run_id. Get the real one from the `Log:` line of the original run or from the `.jsonl` filename in `.loopspec/runs/`.

### `✗ refused to run "<name>": untrusted charter with DANGER-level findings`

A `verify.commands` entry matched a DANGER heuristic. The gate is origin-blind — it does not care that you wrote the charter.

Preferred fix: rewrite the command so it does not match (`npm test` rather than `sh test.sh`). Only if the flagged command is genuinely required, show the user the literal string and the finding, and pass `--yes` after they agree.

### Nothing in `status` / `stats`

Wrong cwd. Both resolve `.loopspec/runs` against `process.cwd()`, not against `--repo`. Run them from wherever `loopspec run` was invoked.
