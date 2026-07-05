# Seed charters

Ready-to-adapt charter examples. Copy one, edit `scope`/`items`/`budget`, then
`loopspec validate <file>` before running.

| Seed | Readiness | What it shows |
|---|---|---|
| `fix-type-errors.charter.yaml` | L1 | multi-item sweep, one file per item, no verify commands |
| `remove-dead-code.charter.yaml` | L1 | single tight-scoped cleanup item |
| `add-jsdoc.charter.yaml` | L1 | doc-only change, behavior must not change |
| `tsc-green.charter.yaml` | L2 | deterministic `verify.commands` + a `denylist` |

L1 vs L2:

- **L1** — `verify.commands` may be empty; a step passes when its scope stays clean.
- **L2** — loopspec runs `verify.commands` after each step; the commands must be
  non-empty (enforced by the validator).

All seeds here are kept passing `validateCharter` by `src/__tests__/seeds.test.ts`.

See the format reference: [`spec/loopspec-1.0.md`](../spec/loopspec-1.0.md).
