# Plan: loopspec Agent Skill — "vibe loop" for any user

> Status: **approved, not yet implemented** (planned branch: `feat/agent-skill`).
> Drafted 2026-07-18 from codebase exploration + OSS skill-convention research
> (Anthropic skill docs, supabase/agent-skills), then hardened by a two-track
> adversarial review (functional vs codebase; conventions vs primary sources).

## Context

loopspec (v0.2.0 in-repo, npm CLI) is functionally complete: charter YAML → bounded `claude -p` sweep with per-item scope enforcement, budgets, JSONL run-log, scorecard. But using it requires learning the charter schema (`spec/loopspec-1.0.md`) and CLI flag semantics (`+Nk`, `--report-only`, `--resume`, L1/L2, …).

Goal: ship a **Claude Code agent skill** in this repo so any user can install it and "vibe loop" — the agent interviews them, authors the charter, validates, previews, confirms budget, runs, and interprets results. The user never touches charter YAML.

Research basis: Anthropic skill-authoring docs + the `supabase/agent-skills` production pattern. The draft plan was then put through an **adversarial review** (2 agents: functional vs codebase, conventions vs primary sources + real OSS skills); all confirmed findings are folded in below.

**User decisions (confirmed):** skill content in **English**; distribution = repo `skills/` dir + **marketplace manifest** (no npm bundling of the skill, no `.claude/skills/` copy); skill name = **`loopspec`**. Branch prefix `feat/`, English conventional commits.

## ⚠ Release blocker (from adversarial review — verified)

**npm has only `loopspec@0.1.0` published** (`npm view loopspec versions`). The 0.2.0 flags the whole skill workflow depends on (`+Nk`, `--report-only`, `--filter`, `--max-iter`, `--agent`) exist only in this repo. Two consequences:

1. **Publishing 0.2.0 is a prerequisite for announcing the skill** (separate release task, not part of the skill branch; `prepublishOnly` already runs test+typecheck+build).
2. SKILL.md must include a **version preflight**: run `loopspec --version`; if < 0.2.0 or missing, instruct `npm install -g loopspec@latest` before proceeding. Never assume the flags exist.

## Deliverables & layout

```
skills/
└── loopspec/
    ├── SKILL.md                              # ~150 lines, the core
    └── references/
        ├── charter-reference.md              # full schema + validator rules + "never emit" list
        ├── results-and-troubleshooting.md    # run-log JSONL schema, failure playbook, resume
        └── seeds.md                          # catalog of the 4 seed charters + adaptation recipe
.claude-plugin/
└── marketplace.json                          # /plugin marketplace add rhc98/loopspec
src/__tests__/skill.test.ts                   # anti-rot CI test
README.md / README.en.md                      # "Agent skill" install section (KR/EN)
AGENTS.md                                     # one Key Files row pointing at skills/loopspec/
```

No `scripts/` in the skill: every fragile operation already exists as a fail-closed CLI command (`validate`, `run --report-only`, in-engine scope enforcement). A wrapper would duplicate and drift. Revisit only if the agent repeatedly fumbles JSONL scorecard extraction.

## 1. SKILL.md

### Frontmatter (review-corrected)

```yaml
---
name: loopspec
description: "Drive bounded, auditable batch LLM automation with the loopspec CLI. Use when the user wants to sweep many files with repetitive scoped fixes (fix all type errors, remove dead code, add JSDoc, make tsc/lint green) with budget limits, per-file scope enforcement, and an audit log — or mentions loopspec, charters, convergent sweeps, or vibe looping. Handles charter authoring, validation, dry-run preview, running, and result interpretation; the user never writes charter YAML themselves."
license: MIT
allowed-tools: Bash(loopspec *), Bash(git *), Bash(npm *), Bash(claude *), Read, Write, Edit, Glob, Grep
metadata:
  author: rhc98
  version: "0.1.0"
---
```

Convention notes (verified against docs + supabase/anthropic skills):
- Plain quoted `description` (no `>-` folding scalar), ≤1024 chars — matches agentskills.io cap.
- `Bash(tool *)` space form is canonical (`:*` is equivalent but less idiomatic).
- `allowed-tools` must cover `git` (dirty-tree check), `npm` (install/upgrade loopspec), `claude` (auth diagnosis) — `Bash(loopspec *)` alone would prompt on every one of these.
- Do NOT use: `when_to_use`/`argument-hint` (non-portable / meaningless here), `context: fork` (skill needs the multi-turn interview — fork loses conversation context), `disable-model-invocation` (skill should auto-trigger).
- `metadata.author/version` mirrors supabase; bump version on skill changes.
- Body notes the caveat that the `allowed-tools` grant lasts only the invoking turn; frictionless multi-turn runs may still prompt (optionally document a persistent allow-rule).

### Body sections (~150 lines, hard cap 500)

1. **What loopspec is** (3 lines) — bounded sweep engine; orchestrator owns convergence; one scoped `claude -p` step per item.
2. **Preflight checklist** — Node ≥18; `loopspec --version` must be ≥ 0.2.0 (else `npm i -g loopspec@latest`); **logged-in** `claude` CLI (loopspec's preflight only checks the binary exists — auth failure surfaces later as failed steps); target is a git repo; if `git status` shows unrelated uncommitted changes, warn the user (scope diff/rollback operate on the working tree); offer to add `.loopspec/` to the target repo's `.gitignore` (loopspec does not do this itself).
3. **The workflow** (numbered, imperative — the core):
   1. *Interview*: goal, target repo path, concrete file list (enumerate with Glob/Grep), deterministic check available (`tsc`, tests, lint)? → L1 vs L2.
   2. *Draft charter*: start from the closest seed (`references/seeds.md`; seeds ship in the npm tarball), write `<name>.charter.yaml` in the target repo root. Item sizing rule: **each item's scope must be tight enough that a single Read,Edit step can finish it** — a small file cluster or one directory glob (seeds use both); items run in array order; only emit v1.0-supported fields. Budget rule: **always set `max_iterations` (≈ items × max_attempts_per_item) — never rely on USD alone** (USD under-counts in subscription mode); include `max_attempts_per_item` and `max_consecutive_failures`.
   3. *Validate*: `loopspec validate <charter>` — fail-closed, fix before proceeding.
   4. *Free preview*: `loopspec run <charter> --report-only` — show the user the item plan; costs nothing, never needs permission.
   5. *Confirm budget, then run*: present item count / scoped files / readiness / cap / exact command; on user affirmative run `loopspec run <charter> +Nk` (rule of thumb: ~15–25k tokens headroom per item, e.g. 3 items → `+50k`). Run from the **target repo root** so `-C` is unneeded and `.loopspec/` lands beside the code; if cwd ≠ target, pass `-C <dir>` and remember state lands under the *invocation* cwd.
   6. *Interpret*: exit 0 = converged, 1 = any early stop (budget / consecutive failures / escalations — the exit code doesn't distinguish; read the scorecard). `loopspec status`/`stats` for the human view — **must be invoked from the same cwd as the run** (they hard-code `cwd/.loopspec/runs`). For detail parse `.loopspec/runs/<name>-<runId>.jsonl`.
   7. *Resume/iterate*: get the **full run_id from the `.jsonl` filename or the `Log:` line — the banner prints only an 8-char prefix which `--resume` will NOT accept** (it silently starts a fresh log). Budget stop → `--resume <fullRunId> +Nk`. Escalated items: `scope-violation` → widen/split scope; `max_attempts` → the log records no failure reason, so re-diagnose live (is `claude` logged in? does the verify command pass manually?) before re-running with `--filter <ids>`.
4. **Trust & safety rules (MUST)** — see §4.
5. **Gotcha table** — `+Nk` over USD; run/status/stats same-cwd; auth not pre-checked; full run_id for resume; deferred-fields "never emit" one-liner; `--report-only` is free.
6. **References pointer block.**

## 2. references/

- **charter-reference.md** (~150 lines): annotated full example charter (CI-validated, see §5), top-level/item/budget field tables distilled from `spec/loopspec-1.0.md`, the 4 fail-closed rules from `src/spec/validator.ts`, L1/L2 decision guide, explicit "never emit" list (`depends_on`, per-item budgets, retry policy, `verify.env_from`, `parameters`, engine/model selectors) **with the warning that the validator silently ignores unknown fields — passing validate does not mean a field works**, budget-sizing heuristics.
- **results-and-troubleshooting.md** (~120 lines): JSONL envelope (`schema_version: 1`) + 8 event types from `src/core/run-log.ts`; computing outcomes/token spend from the log; honest limits: `attempt-completed` records only `outcome`+`usage` (no error text), `item-escalated.reason` is only `max_attempts`|`scope-violation` — generic failures require live re-diagnosis. Failure playbook: auth (every step fails fast → `claude` login), scope violation (rolled back + escalated → widen/split), verify loop (run the command manually first), budget stop (resume with full run_id + `+Nk`).
- **seeds.md** (~60 lines): table of the 4 seeds (`fix-type-errors`, `remove-dead-code`, `add-jsdoc` = L1; `tsc-green` = L2) with "pick this when…" guidance; located at `$(npm root -g)/loopspec/seeds/` for global installs (seeds are in the npm `files` list). Adaptation recipe: copy → rewrite items/scope → validate.

## 3. Distribution

`.claude-plugin/marketplace.json` (review-corrected — `strict: false` is required because the plugin has no `plugin.json`; matches supabase's real manifest):

```json
{
  "name": "loopspec",
  "owner": { "name": "rhc98" },
  "metadata": { "description": "Agent skill for the loopspec convergent sweep engine", "version": "0.1.0" },
  "plugins": [{
    "name": "loopspec",
    "source": "./",
    "description": "Vibe-loop skill: author, validate, run, and interpret loopspec charters.",
    "strict": false,
    "skills": ["./skills/loopspec"]
  }]
}
```

Install paths documented in README: (1) `/plugin marketplace add rhc98/loopspec` → `/plugin install loopspec@loopspec`; (2) `npx skills add rhc98/loopspec` — layout-compatible, but **dry-run verify before advertising** (discovery mechanism not fully specified in the spec); (3) manual copy to `~/.claude/skills/`.

README.en.md: new "Agent skill (vibe loop)" section (what it does, install commands, one example prompt, prerequisite note: published CLI ≥ 0.2.0 + logged-in `claude`). README.md: mirrored Korean section. AGENTS.md: one Key Files row.

## 4. Trust & safety posture (review-corrected)

The naive "self-authored = trusted, never pass `--yes`" rule is **factually wrong and deadlocks**: `run`'s trust gate (`src/cli/run.ts:196-203`) is origin-blind — it scans every charter and refuses (non-interactive exit 1) any charter with DANGER findings that lacks recorded consent, and consent is only recorded by `loopspec install`. A self-authored charter whose verify command matches a DANGER heuristic (`sh script.sh`, `rm -rf`, `curl`, `eval`, …, see `src/core/scan.ts`) would be unrunnable under a blanket `--yes` ban. Corrected rules for SKILL.md:

- **First resort — avoid the pattern**: if a self-authored charter trips a DANGER finding, rewrite the verify command to an equivalent that doesn't match (e.g. `npm test` instead of `sh test.sh`). Common verify commands (`npx tsc --noEmit`, `npm test`, `eslint .`) trip nothing.
- **Escape hatch — explicit user consent only**: if the DANGER-flagged command is genuinely needed, show the user the literal shell string + the scan finding, and only after their affirmative reply run with `--yes` (or record consent via `loopspec install <charter> --yes`). Never auto-`--yes`; never decide alone.
- **Third-party charters are untrusted, period**: `loopspec install <src> --report-only` first, show findings + literal `verify.commands`, require explicit user confirmation before `install` (which itself gates DANGER on `--yes`).
- **Budget gate**: before any token-spending run, present the plan summary and get user affirmative. `--report-only` never needs asking.
- Always bounded stops (`max_iterations`, `max_attempts_per_item`, `max_consecutive_failures`); never USD alone.

## 5. Verification

**Automated — `src/__tests__/skill.test.ts`** (mirrors `src/__tests__/seeds.test.ts`):
- Frontmatter: parse SKILL.md YAML; assert `name === "loopspec"` and equals the skill directory name; name matches spec rules (lowercase alnum+hyphen, no leading/trailing/consecutive hyphens); description non-empty ≤1024 chars; `metadata.version` present; body <500 lines.
- Charter examples: mark **complete** charters with a distinct fence (e.g. ` ```yaml charter `) and validate only those with `validateCharter`; illustrative fragments use plain ` ```yaml ` and are skipped. Because the validator ignores unknown fields, **additionally assert every marked block contains none of the never-emit keys** (`depends_on`, `verify.env_from`, `parameters`, `engine`, `model`, item-level `budget`) — `validateCharter` alone cannot catch doc rot here.
- `references/seeds.md` mentions every `seeds/*.charter.yaml` file.
- `marketplace.json` parses; `plugins[0].strict === false`; every `skills` path exists.

**Manual walkthrough (documented in PR):**
1. Copy `skills/loopspec` → `~/.claude/skills/` in a scratch env; open Claude Code in `fixtures/mini-repo` (`npm run fixtures:init`).
2. "use loopspec to fix the type errors here" → skill triggers, preflights version/auth/gitignore, interviews, writes charter, validates, `--report-only`, budget confirmation, run with `+Nk`.
3. Negative: invalid charter → recovers from validator output; DANGER-flagged verify command → rewrites it (not `--yes`); logged-out `claude` → diagnoses auth from failed steps; early stop → resumes with the **full** run_id.
4. Non-trigger: unrelated prompt must not activate the skill.
5. Distribution dry-run: `/plugin marketplace add` from a local clone; `npx skills add` if advertised.

## 6. Implementation commits (branch `feat/agent-skill`)

1. `feat(skill): add loopspec agent skill core` — `skills/loopspec/SKILL.md`
2. `feat(skill): add charter, results, and seeds reference docs` — `references/*`
3. `feat(skill): add plugin marketplace manifest` — `.claude-plugin/marketplace.json`
4. `test(skill): validate skill frontmatter and embedded charter examples` — `src/__tests__/skill.test.ts`
5. `docs: document agent skill installation in READMEs and AGENTS.md`

Separate follow-up (not this branch): publish `loopspec@0.2.0` to npm — hard prerequisite for announcing the skill.

## Key source files to lean on during implementation

- `spec/loopspec-1.0.md` — authoritative charter format (source for charter-reference.md)
- `src/spec/validator.ts` — `validateCharter`, imported by the new test (remember: ignores unknown fields)
- `src/core/scan.ts` — DANGER heuristics the safety section references
- `src/cli/run.ts` — trust gate (196-203), run_id truncation (212) vs full id in log path (139), exit codes
- `src/core/run-log.ts` — event schema for results reference
- `seeds/` + `src/__tests__/seeds.test.ts` — examples + test pattern to copy
