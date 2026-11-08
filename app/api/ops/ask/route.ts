// Operators only: one turn of AG Studio's Agent Framework, answered by Claude. The browser adapter
// (app/ops/audit/claude-adapter.ts) posts Studio's AgLlmRequest here; the reply is newline-delimited JSON:
// one {"event": AgAiEvent} per line while the model streams, then {"complete": AgLlmResponse}.
// The model only proposes tool calls; Studio runs them in the browser on the anonymized ledger tables,
// so no case PII ever reaches this route or the model, and the key never reaches the browser.
import { randomUUID } from "node:crypto";
import { streamText, type ModelMessage } from "ai";
import { z } from "zod";
import type { AgLlmRequest } from "ag-studio";
import { MODELS, auditorModel } from "@/lib/agent/models";
import { fail, handleRouteError } from "@/lib/http";
import { isOperator } from "@/lib/ops/auth";
import { TurnCollector, toPrompt, toToolChoice, toTools } from "@/lib/ops/llm-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** A Studio turn with its full tool catalogue is ~60 KB; anything near this is not a Studio turn. */
const MAX_BODY_BYTES = 1_500_000;

// Studio builds these requests itself; validate the outline and pass the details through.
const RequestSchema = z.object({
  input: z.array(z.looseObject({ type: z.string() })).max(400),
  instructions: z.string().max(200_000).optional(),
  tools: z.array(z.looseObject({ name: z.string().max(64), description: z.string(), parameters: z.unknown() })).max(64).optional(),
  toolChoice: z.union([z.enum(["auto", "none", "required"]), z.object({ name: z.string() })]).optional(),
  responseFormat: z.looseObject({ type: z.enum(["text", "json"]) }),
});

/**
 * A ceiling on model turns for this process, so the shared operator password cannot turn the route into an
 * open model proxy. A chart request takes about 15 turns, a question 2 to 4.
 */
const LIMITS = [
  { windowMs: 10 * 60_000, max: 150 },
  { windowMs: 24 * 60 * 60_000, max: 1500 },
];
const turns: number[] = [];

function overLimit(now = Date.now()): boolean {
  const oldest = now - LIMITS[LIMITS.length - 1].windowMs;
  while (turns.length && turns[0] < oldest) turns.shift();
  if (LIMITS.some((l) => turns.filter((t) => t >= now - l.windowMs).length >= l.max)) return true;
  turns.push(now);
  return false;
}

export async function POST(req: Request) {
  try {
    if (!(await isOperator())) return fail("sign in first", 401);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail("request too large", 413);
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return fail("body is not JSON", 400);
    }
    const parsed = RequestSchema.safeParse(raw);
    if (!parsed.success) return fail("not a Studio turn request", 400);
    if (overLimit()) return fail("too many questions in a short time", 429);
    const request = parsed.data as unknown as AgLlmRequest;

    const { system, messages } = toPrompt(request);
    const tools = toTools(request.tools);
    const collector = new TurnCollector(randomUUID(), MODELS.auditor, request.tools);
    const abort = new AbortController();
    req.signal.addEventListener("abort", () => abort.abort(), { once: true });

    // The tool catalogue and instructions are the same on every turn of a run (about 13K tokens), so they are
    // cached: the breakpoint on the system message covers the tools rendered before it.
    const cachedSystem: ModelMessage = { role: "system", content: system, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } };
    const result = streamText({
      model: auditorModel(),
      messages: [cachedSystem, ...messages],
      tools,
      toolChoice: toToolChoice(request, tools),
      maxOutputTokens: 4096,
      abortSignal: abort.signal,
      // Thinking off: answers stay quick, and Studio's history has no place for signed thinking blocks.
      providerOptions: { anthropic: { thinking: { type: "disabled" } } },
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        try {
          for await (const part of result.fullStream) {
            for (const event of collector.accept(part)) send({ event });
          }
        } catch (err) {
          collector.fail(err instanceof Error ? err.message : String(err));
        }
        try {
          send({ complete: collector.response() });
          controller.close();
        } catch {
          // the browser went away (run cancelled); nothing left to tell it
        }
      },
      cancel() {
        abort.abort();
      },
    });
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (err) {
    return handleRouteError(err, "ops/ask");
  }
}
