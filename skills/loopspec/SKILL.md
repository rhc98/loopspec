---
name: loopspec
description: "Drive bounded, auditable batch LLM automation with the loopspec CLI. Use when the user wants to sweep many files with repetitive scoped fixes (fix all type errors, remove dead code, add JSDoc, make tsc/lint green) with budget limits, per-file scope enforcement, and an audit log — or mentions loopspec, charters, convergent sweeps, or vibe looping. Handles charter authoring, validation, dry-run preview, running, and result interpretation; the user never writes charter YAML themselves."
license: MIT
allowed-tools: Bash(loopspec *), Bash(git *), Bash(npm *), Bash(claude *), Read, Write, Edit, Glob, Grep
metadata:
  author: rhc98
  version: "0.1.0"
---

# loopspec

Drive the loopspec CLI end to end so the user never writes charter YAML themselves.

## What loopspec is

A **bounded sweep engine**. A charter declares a goal, splits it into scoped **items**, and caps the work with a **budget**. `loopspec run` picks an item, runs one `claude -p` step limited to `Read,Edit` and 5 turns, diffs the working tree to assert the step stayed inside that item's scope, optionally runs verify commands, appends the outcome to a JSONL run-log, and repeats until every item is terminal or a stop condition trips.

loopspec owns convergence and enforcement. You own the interview, the charter, and the interpretation.

## Preflight

Run these before anything else. Each has a specific failure the user cannot diagnose alone.

1. **Version** — `loopspec --version` must be **≥ 0.2.0**. Below that (or command not found) the `+Nk`, `--report-only`, `--filter`, `--max-iter` flags do not exist. Fix: `npm install -g loopspec@latest`. Never assume the flags are present.
2. **Auth** — `claude` must be **logged in**. loopspec's preflight only runs `claude --version`, so a logged-out CLI passes preflight and then fails every step with no useful error. If you cannot confirm login, say so before spending budget.
3. **Git repo** — the target must be a git repo. Scope enforcement and rollback diff the working tree; without git there is nothing to diff against.
4. **Clean tree** — run `git status`. If there are unrelated uncommitted changes, warn the user: a scope violation rolls back *that step's* files, and an unrelated dirty file can be misread as a violation. Offer to let them commit or stash first.
5. **gitignore** — offer to add `.loopspec/` to the target repo's `.gitignore`. loopspec does not do this itself and the run-logs are noise in a diff.

Node ≥ 18 is required.

## Workflow

### 1. Interview

Establish, in the conversation, before writing anything:

- **Goal** — one line, the same shape as a commit message subject.
- **Target repo path.**
- **Concrete file list** — enumerate it yourself with Glob/Grep. Do not ask the user to list files; show them what you found and confirm.
- **Deterministic check?** — is there a command that objectively decides success (`npx tsc --noEmit`, `npm test`, `eslint .`)? Yes → **L2**. No → **L1**.

### 2. Draft the charter

Start from the closest seed (see `references/seeds.md`). Write `<name>.charter.yaml` at the **target repo root**.

**Never run `loopspec init`** — its scaffold emits Korean inline comments.

**Always emit `name`, `goal`, `readiness`, and top-level `scope`.** The validator does not require them, but omitting them breaks things quietly: no `name` writes the log to `undefined-<uuid>.jsonl`; no top-level `scope` crashes `loopspec install` with an uncaught TypeError; no `readiness` silently skips L2 verify enforcement.

**Item sizing** — each item's scope must be tight enough that a **single `Read,Edit` step can finish it**: a small file cluster or one directory glob. Items run in array order. An item too big to finish in 5 turns burns its attempts and escalates.

**Budget** — always set `max_iterations` (≈ items × `max_attempts_per_item`). **Never rely on `max_budget_usd` alone**: under a Claude subscription the reported spend is $0, so a USD-only cap never trips and the run is effectively unbounded. Always include `max_attempts_per_item` and `max_consecutive_failures`.

Emit only v1.0 fields. See `references/charter-reference.md` for the full schema and the never-emit list — and note the validator **silently ignores unknown fields**, so passing `validate` is not evidence that a field does anything.

### 3. Validate

```
loopspec validate <charter>
```

Fail-closed. Fix every reported rule before continuing.

### 4. Free preview

```
loopspec run <charter> --report-only
```

Costs nothing, writes nothing, never touches the run-log — it returns before the trust gate and before preflight. Show the user the item plan it prints. Never ask permission for this.

### 5. Confirm budget, then run

Present, and wait for an explicit yes:

- item count and the files each one scopes
- readiness (L1/L2) and the verify commands, verbatim
- the stop conditions (`max_iterations`, `max_attempts_per_item`, `max_consecutive_failures`)
- the exact command you will run

```
loopspec run <charter> +Nk
```

`+Nk` is **additive headroom over spend-at-start** — the effective cap is tokens-already-spent + N. Rule of thumb: **15–25k per item** (3 items → `+50k`). Format is `+50k` or `+50000`; no decimals, no negatives.

Run from the **target repo root** so `-C` is unneeded and `.loopspec/` lands beside the code. If you must run from elsewhere, pass `-C <dir>` and remember state lands under the *invocation* cwd, not the target.

`--agent` accepts only `claude-code`.

### 6. Interpret

Exit 0 means every item passed. **Exit 1 means anything else** — the exit code is just `passed === total`, so it cannot distinguish a budget stop from a failure. Read the scorecard:

```
  total / passed / failed / escalated / iterations / spent_usd / tokens
```

`loopspec status` and `loopspec stats` give the human view but **must be run from the same cwd as the run** — they resolve `.loopspec/runs` against `process.cwd()`. For detail, parse `.loopspec/runs/<name>-<runId>.jsonl` (see `references/results-and-troubleshooting.md`).

### 7. Resume and iterate

Take the **full run_id** from the `Log:` line or the `.jsonl` filename. **The banner prints only an 8-character prefix; passing that to `--resume` is rejected with `✗ no run-log to resume at <path>`.**

- **Budget or iteration stop** → `loopspec run <charter> --resume <fullRunId> +Nk`. If it answers `✗ resume would make no progress`, you resumed without raising the cap — add `+Nk` or `--max-iter`. `max_budget_usd` has no CLI override; raise it in the charter (which invalidates any trust consent, see below).
- **`scope-violation`** → the step touched files outside the item's scope and was rolled back. Widen or split the item's scope, then re-run with `--filter <ids>`.
- **`max_attempts`** → the log records *no* failure reason. Re-diagnose live before retrying: is `claude` logged in? Does the verify command pass when you run it by hand? Is the item too big for one step?

## Trust & safety — MUST

The trust gate is **origin-blind**. It scans every charter, including one you just wrote, and refuses any with DANGER findings that lacks recorded consent. Consent is only recorded by `loopspec install`.

- **First resort: avoid the pattern.** If a charter you authored trips a DANGER finding, rewrite the verify command to an equivalent that does not. `npx tsc --noEmit`, `npm test`, and `eslint .` trip nothing; `sh test.sh` trips `script-exec`.
- **Escape hatch: explicit user consent only.** If the flagged command is genuinely needed, show the user the literal shell string *and* the scan finding, and pass `--yes` only after an affirmative reply. **Never auto-`--yes`. Never decide alone.**
- **Third-party charters are untrusted, period.** `loopspec install <src> --report-only` first, show the findings and the verbatim `verify.commands`, and require explicit confirmation before installing.
- **Budget gate** before any token-spending run (step 5). `--report-only` never needs asking.
- **WARN findings do not block.** `npm ci`, `$(...)`, backticks, and broad globs print warnings and proceed. Mention them; do not treat them as errors.

## Gotchas

| Gotcha | Rule |
|---|---|
| USD cap never trips on a subscription | Always set `max_iterations`, never USD alone |
| `status`/`stats` show nothing | Run them from the same cwd as the run |
| Every step fails instantly | `claude` is logged out — preflight does not check auth |
| `--resume` rejects the id | Use the full run_id from the `Log:` line, not the 8-char banner prefix |
| `validate` passed but the field is ignored | Unknown fields are silently dropped; check the reference |
| Charter edited after `install` | Consent is keyed on the raw bytes — even a comment change invalidates it |
| `--report-only` | Always free, always safe, never needs permission |

## References

- `references/charter-reference.md` — full schema, validation rules, always-emit and never-emit lists, budget sizing
- `references/results-and-troubleshooting.md` — run-log event schema, failure playbook
- `references/seeds.md` — the four shipped seeds and how to adapt them

Note: the `allowed-tools` grant above applies to the invoking turn. A multi-turn run may still prompt for permission on later commands.
