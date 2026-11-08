// Translates between AG Studio's provider-neutral LLM turn (AgLlmRequest / AgAiEvent / AgLlmResponse) and the
// Vercel AI SDK, so Studio's Agent Framework can run on Claude. Pure functions, no I/O: the route in
// app/api/ops/ask does the call, and tests/llm-bridge.test.ts covers the mapping.
import { jsonSchema, tool, type ModelMessage, type TextStreamPart, type ToolChoice, type ToolSet } from "ai";
import type {
  AgAiConversationItem,
  AgAiEvent,
  AgAiOutputItem,
  AgAiToolCall,
  AgAiToolSchema,
  AgJSONSchema,
  AgLlmRequest,
  AgLlmResponse,
} from "ag-studio";

export interface BridgedPrompt {
  system: string;
  messages: ModelMessage[];
}

const textOf = (content: Array<{ type: string; text?: string; refusal?: string }>) =>
  content
    .map((c) => c.text ?? c.refusal ?? "")
    .filter(Boolean)
    .join("\n");

/**
 * Studio's conversation items as AI SDK messages. System-role items (Studio's context notes) join the
 * system prompt, reasoning items are dropped (thinking is off for this route), and consecutive assistant
 * parts or tool results are merged so the roles alternate the way the Messages API expects.
 */
export function toPrompt(request: Pick<AgLlmRequest, "input" | "instructions" | "responseFormat" | "toolChoice">): BridgedPrompt {
  const system: string[] = [];
  if (request.instructions) system.push(request.instructions);
  const toolNames = new Map<string, string>();
  const messages: ModelMessage[] = [];

  const last = () => messages[messages.length - 1];
  const pushAssistant = (part: { type: "text"; text: string } | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }) => {
    const prev = last();
    if (prev?.role === "assistant" && Array.isArray(prev.content)) prev.content.push(part);
    else messages.push({ role: "assistant", content: [part] });
  };

  for (const item of request.input as AgAiConversationItem[]) {
    if (item.type === "message" && item.kind === "input") {
      const text = textOf(item.content);
      if (!text) continue;
      if (item.role === "system") system.push(text);
      else messages.push({ role: "user", content: text });
    } else if (item.type === "message") {
      const text = textOf(item.content);
      if (text) pushAssistant({ type: "text", text });
    } else if (item.type === "function_call") {
      toolNames.set(item.callId, item.name);
      pushAssistant({ type: "tool-call", toolCallId: item.callId, toolName: item.name, input: parseArgs(item.arguments) });
    } else if (item.type === "function_call_output") {
      const part = {
        type: "tool-result" as const,
        toolCallId: item.callId,
        toolName: toolNames.get(item.callId) ?? "tool",
        output: { type: "text" as const, value: item.output || "(no output)" },
      };
      const prev = last();
      if (prev?.role === "tool") prev.content.push(part);
      else messages.push({ role: "tool", content: [part] });
    }
    // reasoning items: nothing to send back with thinking off
  }

  if (request.responseFormat?.type === "json") {
    system.push(
      `Reply with a single JSON object named "${request.responseFormat.name}" that matches this JSON Schema, with no prose and no code fences:\n${JSON.stringify(request.responseFormat.schema)}`,
    );
  }
  const choice = request.toolChoice;
  if (choice && typeof choice === "object") system.push(`On this turn, call the ${choice.name} tool.`);
  else if (choice === "required") system.push("On this turn, call at least one tool.");

  return { system: system.join("\n\n"), messages };
}

function parseArgs(args: string): unknown {
  try {
    return args ? JSON.parse(args) : {};
  } catch {
    return {};
  }
}

/**
 * Studio's tool schemas as AI SDK tools with no `execute`: the model only proposes calls, which stream back
 * to the browser, where Studio runs them against the report and sends the results on the next turn.
 */
export function toTools(schemas: AgAiToolSchema[] | undefined): ToolSet | undefined {
  const usable = (schemas ?? []).filter((s) => s.kind !== "provided");
  if (usable.length === 0) return undefined;
  const out: ToolSet = {};
  for (const s of usable) {
    out[s.name] = tool({ description: s.description, inputSchema: jsonSchema(objectSchema(s.parameters)) });
  }
  return out;
}

/** The Messages API wants an object schema for every tool, even one that takes nothing. */
function objectSchema(schema: AgJSONSchema | undefined): Parameters<typeof jsonSchema>[0] {
  const s = (schema ?? {}) as Record<string, unknown>;
  return (s.type === "object" ? s : { type: "object", properties: {}, ...s }) as Parameters<typeof jsonSchema>[0];
}

/**
 * Forced tool choice is not accepted by every current Claude model, so 'required' and a named tool become
 * 'auto' plus a line in the system prompt (added by toPrompt).
 */
export function toToolChoice(request: Pick<AgLlmRequest, "toolChoice">, tools: ToolSet | undefined): ToolChoice<ToolSet> | undefined {
  if (!tools) return undefined;
  return request.toolChoice === "none" ? "none" : "auto";
}

type JsonSchemaLike = { type?: string | string[]; properties?: Record<string, JsonSchemaLike> };

/** JSON.parse, forgiving the one or two extra closing brackets a model sometimes adds at the end. */
function parseLoose(value: string): unknown {
  let text = value.trim();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return JSON.parse(text);
    } catch (err) {
      if (!/[}\]]$/.test(text)) throw err;
      text = text.slice(0, -1);
    }
  }
  return JSON.parse(text);
}

/**
 * Smaller models sometimes send an object argument as a JSON string ("query": "{\"kind\": ...}"), add a
 * stray closing bracket to it, or wrap it in its own name ({"query": {"query": {...}}}). Where the tool's
 * schema does not allow a string for that property, put back the object the model meant, so Studio's
 * validation passes instead of failing the call and costing a round trip.
 */
export function repairArguments(input: unknown, parameters: AgJSONSchema | undefined): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const props = (parameters as JsonSchemaLike | undefined)?.properties ?? {};
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const [key, original] of Object.entries(out)) {
    const declared = props[key]?.type;
    if (declared === "string" || (Array.isArray(declared) && declared.includes("string"))) continue;
    let value = original;
    if (typeof value === "string" && /^\s*[[{]/.test(value)) {
      try {
        value = parseLoose(value);
      } catch {
        continue; // not JSON after all: leave it for Studio to report
      }
    }
    // {"query": {"query": {...}}} -> {"query": {...}}
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const keys = Object.keys(value);
      const inner = (value as Record<string, unknown>)[key];
      if (keys.length === 1 && keys[0] === key && inner && typeof inner === "object") value = inner;
    }
    out[key] = value;
  }
  return out;
}

/** Folds the AI SDK stream into Studio events and, at the end, the turn's consolidated response. */
export class TurnCollector {
  private text = new Map<string, string>();
  private textOrder: string[] = [];
  private calls: AgAiToolCall[] = [];
  private finishReason: string | undefined;
  private usage: AgLlmResponse["usage"];
  private error: string | undefined;

  private readonly parameters: Map<string, AgJSONSchema | undefined>;

  constructor(
    private readonly responseId: string,
    private readonly model: string,
    tools: AgAiToolSchema[] = [],
  ) {
    this.parameters = new Map(tools.map((t) => [t.name, t.parameters]));
  }

  /** Studio events for one stream part (often none). */
  accept(part: TextStreamPart<ToolSet>): AgAiEvent[] {
    switch (part.type) {
      case "text-start":
        this.text.set(part.id, "");
        this.textOrder.push(part.id);
        return [{ type: "TEXT_MESSAGE_START", messageId: part.id, role: "assistant" }];
      case "text-delta":
        this.text.set(part.id, (this.text.get(part.id) ?? "") + part.text);
        return part.text ? [{ type: "TEXT_MESSAGE_CONTENT", messageId: part.id, delta: part.text }] : [];
      case "text-end":
        return [{ type: "TEXT_MESSAGE_END", messageId: part.id }];
      // Tool arguments are sent whole once the call is complete (not as they stream), so they can be repaired first.
      case "tool-call": {
        const args = JSON.stringify(repairArguments(part.input ?? {}, this.parameters.get(part.toolName)));
        this.calls.push({ id: `fc_${part.toolCallId}`, kind: "output", type: "function_call", callId: part.toolCallId, name: part.toolName, arguments: args, status: "completed" });
        return [
          { type: "TOOL_CALL_START", toolCallId: part.toolCallId, toolCallName: part.toolName },
          { type: "TOOL_CALL_ARGS", toolCallId: part.toolCallId, delta: args },
          { type: "TOOL_CALL_END", toolCallId: part.toolCallId },
        ];
      }
      case "finish":
        this.finishReason = part.finishReason;
        this.usage = {
          inputTokens: part.totalUsage.inputTokens ?? 0,
          outputTokens: part.totalUsage.outputTokens ?? 0,
          totalTokens: part.totalUsage.totalTokens,
          cachedInputTokens: part.totalUsage.cachedInputTokens,
        };
        return [];
      case "error":
        this.error = part.error instanceof Error ? part.error.message : String(part.error);
        return [];
      default:
        return [];
    }
  }

  fail(message: string): void {
    this.error = message;
  }

  response(): AgLlmResponse {
    const output: AgAiOutputItem[] = [];
    const text = this.textOrder.map((id) => this.text.get(id) ?? "").join("");
    if (text) {
      output.push({ id: `msg_${this.responseId}`, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
    }
    output.push(...this.calls);
    const base = { id: this.responseId, createdAt: Date.now(), output, usage: this.usage, model: this.model };
    if (this.error) return { ...base, status: "failed", error: { code: "provider_error", message: this.error } };
    if (this.finishReason === "length") return { ...base, status: "incomplete", incompleteDetails: { reason: "max_output_tokens" } };
    if (this.finishReason === "content-filter") return { ...base, status: "incomplete", incompleteDetails: { reason: "content_filter" } };
    return { ...base, status: "completed" };
  }
}
