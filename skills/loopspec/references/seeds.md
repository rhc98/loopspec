# Seeds

Four charters ship with loopspec. Start from the closest one and adapt it — never from `loopspec init`, whose scaffold emits Korean inline comments.

For a global install they live at:

```
$(npm root -g)/loopspec/seeds/
```

From a source checkout, `seeds/` at the repo root.

## The four

| Seed | Readiness | Shape | Pick this when… |
|---|---|---|---|
| `fix-type-errors.charter.yaml` | L1 | 2 items, one file each | the user wants per-file fixes and the check happens later. The canonical multi-item template — copy this first when in doubt. |
| `remove-dead-code.charter.yaml` | L1 | 1 item, one file | deletion-shaped work: unused exports, dead branches, stale imports. Note the "do not change behavior" phrasing in its description — keep that. |
| `add-jsdoc.charter.yaml` | L1 | 1 item, one file | additive documentation with an explicit no-logic-changes constraint. The template for "touch the file but change nothing that runs." |
| `tsc-green.charter.yaml` | **L2** | 1 item, a directory glob | a deterministic command decides success. The only seed with real `verify.commands` and a `denylist`. Copy this whenever the user has `tsc`, tests, or a linter. |

`tsc-green` is the one to reach for most often in practice — an L2 charter is the difference between "the agent edited the file" and "the file is correct."

## Adaptation recipe

1. **Copy** the closest seed into the target repo root as `<name>.charter.yaml`.
2. **Rewrite `name` and `goal`** to the user's actual task.
3. **Replace `items`.** One item per unit a single `Read,Edit` step can finish — a small file cluster or one directory glob. `fix-type-errors` shows the per-file pattern; `tsc-green` shows the directory-glob pattern. Keep each `description` specific: the agent has only `Read` and `Edit` and cannot go looking for context.
4. **Set both scopes.** Top-level `scope.include` is the repo-wide allow-list; each item's `scope.include` is the hard boundary for that step.
5. **Size the budget.** `max_iterations` ≈ items × `max_attempts_per_item`. Scale the seed's values to the new item count — do not ship a 2-item seed's `max_iterations: 6` with 10 items.
6. **Verify.** L2 → put the real command in `verify.commands` and run it by hand once first. L1 → leave `commands: []`.
7. `loopspec validate <charter>`, then `loopspec run <charter> --report-only`.

## What to carry over unchanged

The seeds encode a few decisions worth keeping:

- **Constraint clauses in `description`** — "without changing its public API", "do not change behavior", "no logic changes". These are the main lever you have over step behavior; keep them and adapt them.
- **`denylist: ["WebSearch", "WebFetch"]`** from `tsc-green` — sensible on any charter. The step should work from the repo, not the web.
- **`per_step_max_budget_usd`** — advisory, but harmless and documents intent.
