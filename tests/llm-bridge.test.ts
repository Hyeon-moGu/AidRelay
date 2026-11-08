import { describe, expect, it } from "vitest";
import type { AgAiToolSchema, AgLlmRequest } from "ag-studio";
import { TurnCollector, repairArguments, toPrompt, toToolChoice, toTools } from "@/lib/ops/llm-bridge";

const text = (t: string) => [{ type: "text" as const, text: t }];

describe("toPrompt", () => {
  it("maps Studio's history to alternating AI SDK messages, with system notes in the system prompt", () => {
    const request = {
      instructions: "You are the auditor.",
      responseFormat: { type: "text" },
      input: [
        { id: "1", kind: "input", type: "message", role: "user", status: "completed", content: text("How much was paid?") },
        { id: "2", kind: "input", type: "message", role: "system", status: "completed", content: text("Page: ledger") },
        { id: "3", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: "Let me check.", annotations: [] }] },
        { id: "4", kind: "output", type: "function_call", callId: "c1", name: "execute_query", arguments: '{"query":{"kind":"apiQuery"}}' },
        { id: "5", kind: "output", type: "function_call", callId: "c2", name: "view_schema", arguments: "" },
        { kind: "input", type: "function_call_output", callId: "c1", output: '{"rows":[]}', status: "completed" },
        { kind: "input", type: "function_call_output", callId: "c2", output: "", status: "completed" },
        { id: "6", kind: "output", type: "reasoning", summary: [] },
      ],
    } as unknown as AgLlmRequest;

    const { system, messages } = toPrompt(request);
    expect(system).toContain("You are the auditor.");
    expect(system).toContain("Page: ledger");
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(messages[1].content).toEqual([
      { type: "text", text: "Let me check." },
      { type: "tool-call", toolCallId: "c1", toolName: "execute_query", input: { query: { kind: "apiQuery" } } },
      { type: "tool-call", toolCallId: "c2", toolName: "view_schema", input: {} },
    ]);
    expect(messages[2].content).toEqual([
      { type: "tool-result", toolCallId: "c1", toolName: "execute_query", output: { type: "text", value: '{"rows":[]}' } },
      { type: "tool-result", toolCallId: "c2", toolName: "view_schema", output: { type: "text", value: "(no output)" } },
    ]);
  });

  it("turns a JSON response format and a forced tool into instructions, since forced tool choice is not portable", () => {
    const request = {
      input: [],
      responseFormat: { type: "json", name: "plan", schema: { type: "object" } },
      toolChoice: { name: "complete_task" },
    } as unknown as AgLlmRequest;
    const { system } = toPrompt(request);
    expect(system).toContain('JSON object named "plan"');
    expect(system).toContain("call the complete_task tool");
    expect(toToolChoice(request, toTools([{ name: "complete_task", description: "", parameters: { type: "object" } } as AgAiToolSchema]))).toBe("auto");
  });
});

describe("toTools", () => {
  it("passes client tools through without execute and skips provider-hosted ones", () => {
    const tools = toTools([
      { name: "view_schema", description: "Read the schema", parameters: { type: "object", properties: {} } },
      { name: "no_params", description: "Takes nothing", parameters: undefined as never },
      { name: "web_search", description: "hosted", parameters: {} as never, kind: "provided" },
    ] as AgAiToolSchema[]);
    expect(Object.keys(tools ?? {})).toEqual(["view_schema", "no_params"]);
    expect(tools?.view_schema.execute).toBeUndefined();
    expect(toTools([])).toBeUndefined();
  });
});

describe("repairArguments", () => {
  const schema = { type: "object", properties: { query: { anyOf: [{ type: "object" }] }, note: { type: "string" } } } as never;

  it("parses an object sent as a JSON string, forgiving a stray closing bracket", () => {
    expect(repairArguments({ query: '{"kind":"apiQuery","limit":{"count":5}}}' }, schema)).toEqual({ query: { kind: "apiQuery", limit: { count: 5 } } });
  });

  it("unwraps an argument wrapped in its own name", () => {
    expect(repairArguments({ query: { query: { kind: "apiQuery" } } }, schema)).toEqual({ query: { kind: "apiQuery" } });
  });

  it("leaves string properties and non-JSON text alone", () => {
    expect(repairArguments({ note: '{"keep":1}', query: "{oops" }, schema)).toEqual({ note: '{"keep":1}', query: "{oops" });
  });
});

describe("TurnCollector", () => {
  it("streams text and whole, repaired tool calls, then reports the turn", () => {
    const c = new TurnCollector("r1", "claude-haiku-5-5", [{ name: "execute_query", description: "", parameters: { type: "object", properties: { query: {} } } } as AgAiToolSchema]);
    const events = [
      ...c.accept({ type: "text-start", id: "t" } as never),
      ...c.accept({ type: "text-delta", id: "t", text: "Checking." } as never),
      ...c.accept({ type: "text-end", id: "t" } as never),
      ...c.accept({ type: "tool-call", toolCallId: "k1", toolName: "execute_query", input: { query: '{"kind":"apiQuery"}' } } as never),
      ...c.accept({ type: "finish", finishReason: "tool-calls", totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } as never),
    ];
    expect(events.map((e) => e.type)).toEqual(["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END"]);
    const response = c.response();
    expect(response.status).toBe("completed");
    expect(response.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(response.output).toEqual([
      { id: "msg_r1", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: "Checking.", annotations: [] }] },
      { id: "fc_k1", kind: "output", type: "function_call", callId: "k1", name: "execute_query", arguments: '{"query":{"kind":"apiQuery"}}', status: "completed" },
    ]);
  });

  it("reports a provider error and a cut-off turn", () => {
    const failed = new TurnCollector("r2", "m");
    failed.accept({ type: "error", error: new Error("overloaded") } as never);
    expect(failed.response()).toMatchObject({ status: "failed", error: { message: "overloaded" } });
    const cut = new TurnCollector("r3", "m");
    cut.accept({ type: "finish", finishReason: "length", totalUsage: {} } as never);
    expect(cut.response()).toMatchObject({ status: "incomplete", incompleteDetails: { reason: "max_output_tokens" } });
  });
});
