import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { parseStreamJson, countBashCalls } from "../adapters/claude-code.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRANSCRIPT = resolve(__dirname, "../../fixtures/transcripts/run2.stream-json");

describe("parseStreamJson (recorded transcript replay)", () => {
  const raw = readFileSync(TRANSCRIPT, "utf8");
  const result = parseStreamJson(raw);

  it("reports no error on a successful run", () => {
    expect(result.isError).toBe(false);
  });

  it("extracts Read and Edit tool calls", () => {
    expect(result.toolCalls).toContain("Read");
    expect(result.toolCalls).toContain("Edit");
  });

  it("records no Bash-class tool calls", () => {
    expect(countBashCalls(result.toolCalls)).toBe(0);
  });

  it("parses usage with positive output_tokens", () => {
    expect(result.usage).toBeDefined();
    expect(result.usage!.output_tokens).toBeGreaterThan(0);
  });
});

describe("parseStreamJson (unit)", () => {
  it("flags is_error from a result event", () => {
    const raw = JSON.stringify({ type: "result", is_error: true, usage: {}, result: "boom" });
    expect(parseStreamJson(raw).isError).toBe(true);
  });

  it("tolerates non-JSON lines", () => {
    const raw = "not json\n" + JSON.stringify({ type: "result", is_error: false, usage: { output_tokens: 1 }, result: "ok" });
    const r = parseStreamJson(raw);
    expect(r.isError).toBe(false);
    expect(r.text).toBe("ok");
  });

  it("captures permission_denials tool names", () => {
    const raw = JSON.stringify({
      type: "result",
      is_error: false,
      usage: { output_tokens: 1 },
      result: "ok",
      permission_denials: [{ tool_name: "Bash" }, { tool_name: "WebFetch" }],
    });
    expect(parseStreamJson(raw).permissionDenials).toEqual(["Bash", "WebFetch"]);
  });

  it("omits permissionDenials when there are none", () => {
    const raw = JSON.stringify({ type: "result", is_error: false, usage: { output_tokens: 1 }, result: "ok" });
    expect(parseStreamJson(raw).permissionDenials).toBeUndefined();
  });
});
