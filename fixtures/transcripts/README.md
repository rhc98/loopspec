# Recorded transcripts

`run2.stream-json` is a deterministic replay fixture for `src/__tests__/claude-code-parse.test.ts`.

## Provenance

The **usage numbers and outcome** (`tools=[Read,Edit]`, `output_tokens: 357`,
`total_cost_usd: 0.241898`, `is_error: false`) are taken verbatim from the
real Ship 0 spike **run 2** recorded in `spike/results.jsonl`. The surrounding
NDJSON envelope (system/assistant/user/result events) reproduces the exact
`claude --output-format stream-json --verbose` wire format that
`parseStreamJson` consumes.

This fixture was **assembled from real run-2 data** rather than captured live,
because the `claude` CLI was not logged in (`Not logged in · Please run /login`)
in the implementation shell. The parser only reads event types, `tool_use`
block names, `is_error`, and the result `usage` object — all faithful here.

## Re-record with a live, logged-in CLI

```bash
git -C fixtures/mini-repo checkout HEAD -- .   # restore broken a.ts (greet(42))
claude -p 'Task: Fix the type error in src/a.ts

CONSTRAINTS (strictly enforced):
- Edit ONLY files in: src/a.ts
- Do NOT run shell commands, tests, or build tools
- Do NOT edit any other files
- Make the minimal change and stop
- Return immediately after editing

Context: Fix type errors and unused variables in fixture repo' \
  --output-format stream-json --verbose --allowedTools Read,Edit --max-turns 5 \
  > fixtures/transcripts/run2.stream-json   # run from inside fixtures/mini-repo

git -C fixtures/mini-repo checkout HEAD -- .   # reset again afterwards
```
