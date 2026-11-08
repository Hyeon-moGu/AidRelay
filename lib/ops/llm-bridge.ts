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

  pairToolResults(messages);

  if (request.responseFormat?.type === "json") {
    system.push(
      `Reply with a single JSON object named "${request.responseFormat.name}" that matches this JSON Schema, with no prose and no code fences:\n${JSON.stringify(request.responseFormat.schema)}`,
    );
  }
  const choice = request.toolChoice;
  if (choice && typeof choice === "object") system.push(`On this turn, call the ${choice.name} tool.`);
  else if (choice === "required") system.push("On this turn, call at least one tool.");

  // Studio retries a delegated agent that answered in prose by re-sending its history, which then ends on
  // the assistant. The Messages API reads a final assistant turn as a prefill and rejects it, so the turn
  // gets a short user line instead.
  if (messages[messages.length - 1]?.role === "assistant") {
    messages.push({ role: "user", content: choice && typeof choice === "object" ? `Call ${choice.name} now with a short summary of what you did.` : "Continue." });
  }

  return { system: system.join("\n\n"), messages };
}

/**
 * The Messages API needs every tool call answered by a result in the next message, and no result without
 * its call. A run stopped between the two (the operator pressed Stop) would leave either behind, so a
 * missing result is filled in as "(not run)" and an orphan result is dropped.
 */
function pairToolResults(messages: ModelMessage[]): void {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    const calls = m.content.flatMap((p) => (p.type === "tool-call" ? [p] : []));
    if (calls.length === 0) continue;
    const next = messages[i + 1];
    const results = next?.role === "tool" ? next.content : [];
    const answered = new Set(results.flatMap((p) => (p.type === "tool-result" ? [p.toolCallId] : [])));
    const missing = calls
      .filter((c) => !answered.has(c.toolCallId))
      .map((c) => ({ type: "tool-result" as const, toolCallId: c.toolCallId, toolName: c.toolName, output: { type: "text" as const, value: "(not run)" } }));
    if (missing.length === 0) continue;
    if (next?.role === "tool") next.content.push(...missing);
    else messages.splice(i + 1, 0, { role: "tool", content: missing });
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "tool") continue;
    const prev = messages[i - 1];
    const called = new Set(prev?.role === "assistant" && Array.isArray(prev.content) ? prev.content.flatMap((p) => (p.type === "tool-call" ? [p.toolCallId] : [])) : []);
    m.content = m.content.filter((p) => p.type !== "tool-result" || called.has(p.toolCallId));
    if (m.content.length === 0) messages.splice(i, 1);
  }
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
 * Studio's tool choice for the AI SDK. The auditor's model (Claude Haiku 5.5) accepts forced tool use;
 * toPrompt also states the choice in the system prompt, as a backup for a model that would not.
 */
export function toToolChoice(request: Pick<AgLlmRequest, "toolChoice">, tools: ToolSet | undefined): ToolChoice<ToolSet> | undefined {
  if (!tools) return undefined;
  const choice = request.toolChoice;
  if (choice && typeof choice === "object") return choice.name in tools ? { type: "tool", toolName: choice.name } : "auto";
  if (choice === "required" || choice === "none") return choice;
  return "auto";
}

type JsonSchemaLike = { type?: string | string[]; properties?: Record<string, JsonSchemaLike>; anyOf?: JsonSchemaLike[]; oneOf?: JsonSchemaLike[]; $ref?: string };

/** True unless the schema clearly allows only non-string values (a $ref we cannot see counts as "may be a string"). */
function mayBeString(schema: JsonSchemaLike | undefined): boolean {
  if (!schema) return true;
  if (schema.$ref) return true;
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches) return branches.some(mayBeString);
  const type = schema.type;
  if (type === undefined) return true;
  return type === "string" || (Array.isArray(type) && type.includes("string"));
}

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
    if (mayBeString(props[key])) continue;
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
  /** Tokens written to the prompt cache; the provider reports them only in its metadata. */
  private cacheWrite = 0;
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
      // The provider numbers text blocks per turn ("0", "1"), and Studio keeps one chat entry per message
      // id, so ids are scoped to this turn or a later answer would overwrite an earlier one.
      case "text-start":
        this.text.set(part.id, "");
        this.textOrder.push(part.id);
        return [{ type: "TEXT_MESSAGE_START", messageId: this.messageId(part.id), role: "assistant" }];
      case "text-delta":
        this.text.set(part.id, (this.text.get(part.id) ?? "") + part.text);
        return part.text ? [{ type: "TEXT_MESSAGE_CONTENT", messageId: this.messageId(part.id), delta: part.text }] : [];
      case "text-end":
        return [{ type: "TEXT_MESSAGE_END", messageId: this.messageId(part.id) }];
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
      case "finish-step": {
        const anthropic = part.providerMetadata?.anthropic as { cacheCreationInputTokens?: number | null } | undefined;
        this.cacheWrite += Number(anthropic?.cacheCreationInputTokens ?? 0);
        return [];
      }
      case "finish": {
        this.finishReason = part.finishReason;
        // Studio's AgAiUsage counts cache reads and writes inside inputTokens; the provider reports them apart.
        const read = part.totalUsage.cachedInputTokens ?? 0;
        const input = (part.totalUsage.inputTokens ?? 0) + read + this.cacheWrite;
        const output = part.totalUsage.outputTokens ?? 0;
        this.usage = { inputTokens: input, outputTokens: output, totalTokens: input + output, cachedInputTokens: read, cacheWriteTokens: this.cacheWrite };
        return [];
      }
      case "error":
        this.error = part.error instanceof Error ? part.error.message : String(part.error);
        return [];
      default:
        return [];
    }
  }

  private messageId(partId: string): string {
    return `${this.responseId}:${partId}`;
  }

  fail(message: string): void {
    this.error = message;
  }

  response(): AgLlmResponse {
    const output: AgAiOutputItem[] = [];
    const text = this.textOrder
      .map((id) => this.text.get(id)?.trim() ?? "")
      .filter(Boolean)
      .join("\n\n");
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
