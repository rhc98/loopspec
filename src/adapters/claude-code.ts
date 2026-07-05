import { execa } from "execa";
import type { StepInput, StepOutput, Usage } from "./types.js";

/**
 * Fail-closed preflight. claude CLI 가 PATH 에 없으면 throw.
 * env 자격증명(CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY)이 없어도
 * 구독(keychain) 로그인으로 동작할 수 있으므로 binary 존재만 강제한다.
 */
export async function preflight(): Promise<void> {
  try {
    await execa("claude", ["--version"]);
  } catch {
    throw new Error(
      "`claude` CLI not found on PATH. Install Claude Code, or set CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY.",
    );
  }
}

const BASH_TOOL_NAMES = new Set(["Bash", "bash", "computer", "run_command", "execute_command"]);

interface StreamEvent {
  type?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: Record<string, number>;
  result?: unknown;
  permission_denials?: Array<{ tool_name?: string }>;
  message?: { content?: Array<{ type?: string; name?: string }> };
}

/**
 * stream-json(NDJSON) 파싱. is_error 우선 판정(spike에서 검증).
 * 순수함수 — recorded transcript replay 로 네트워크 없이 테스트 가능.
 */
export function parseStreamJson(raw: string): StepOutput {
  const lines = raw.split("\n").filter(Boolean);
  const toolCalls: string[] = [];
  const permissionDenials: string[] = [];
  let isError = false;
  let resultText = "";
  let usage: Usage | undefined;

  for (const line of lines) {
    let event: StreamEvent;
    try {
      event = JSON.parse(line) as StreamEvent;
    } catch {
      continue;
    }

    if (event.is_error === true) isError = true;

    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "tool_use" && block.name) {
          toolCalls.push(block.name);
        }
      }
    }

    if (event.type === "result") {
      if (event.is_error) isError = true;
      const u = event.usage ?? {};
      usage = {
        input_tokens: u.input_tokens ?? 0,
        output_tokens: u.output_tokens ?? 0,
        cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
        total_cost_usd: event.total_cost_usd,
      };
      resultText = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
      for (const d of event.permission_denials ?? []) {
        if (d.tool_name) permissionDenials.push(d.tool_name);
      }
    }
  }

  return {
    text: resultText,
    usage,
    isError,
    toolCalls,
    ...(permissionDenials.length > 0 ? { permissionDenials } : {}),
  };
}

/** allowedTools 화이트리스트가 Bash 류 호출을 기계적으로 차단. */
export function countBashCalls(toolCalls: string[]): number {
  return toolCalls.filter((t) => BASH_TOOL_NAMES.has(t)).length;
}

export async function runStep(input: StepInput): Promise<StepOutput> {
  let raw = "";
  let spawnError: string | undefined;

  const args = [
    "-p",
    input.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--allowedTools",
    input.allowedTools.join(","),
    "--max-turns",
    String(input.maxTurns),
  ];
  if (input.disallowedTools && input.disallowedTools.length > 0) {
    args.push("--disallowedTools", input.disallowedTools.join(","));
  }

  try {
    const result = await execa("claude", args, { cwd: input.cwd, reject: false, timeout: 120_000 });
    raw = result.stdout ?? "";
  } catch (err: unknown) {
    const e = err as { stdout?: string; message?: string };
    raw = e.stdout ?? "";
    spawnError = e.message ?? "unknown spawn error";
  }

  const parsed = parseStreamJson(raw);
  if (spawnError) {
    parsed.spawnError = spawnError;
    parsed.isError = true;
  }
  return parsed;
}
