// Operators only: one turn of AG Studio's Agent Framework, answered by Claude. The browser adapter
// (app/ops/audit/claude-adapter.ts) posts Studio's AgLlmRequest here; the reply is newline-delimited JSON:
// one {"event": AgAiEvent} per line while the model streams, then {"complete": AgLlmResponse}.
// The model only proposes tool calls; Studio runs them in the browser on the anonymized ledger tables,
// so no case PII ever reaches this route or the model, and the key never reaches the browser.
import { randomUUID } from "node:crypto";
import { streamText } from "ai";
import { z } from "zod";
import type { AgLlmRequest } from "ag-studio";
import { MODELS, auditorModel } from "@/lib/agent/models";
import { fail, handleRouteError } from "@/lib/http";
import { isOperator } from "@/lib/ops/auth";
import { TurnCollector, toPrompt, toToolChoice, toTools } from "@/lib/ops/llm-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Studio builds these requests itself; validate the outline and pass the details through.
const RequestSchema = z.object({
  input: z.array(z.looseObject({ type: z.string() })).max(400),
  instructions: z.string().max(200_000).optional(),
  tools: z.array(z.looseObject({ name: z.string().max(64), description: z.string(), parameters: z.unknown() })).max(64).optional(),
  toolChoice: z.union([z.enum(["auto", "none", "required"]), z.object({ name: z.string() })]).optional(),
  responseFormat: z.looseObject({ type: z.enum(["text", "json"]) }),
});

export async function POST(req: Request) {
  try {
    if (!(await isOperator())) return fail("sign in first", 401);
    const parsed = RequestSchema.safeParse(await req.json());
    if (!parsed.success) return fail("not a Studio turn request", 400);
    const request = parsed.data as unknown as AgLlmRequest;
    const { system, messages } = toPrompt(request);
    const tools = toTools(request.tools);
    const collector = new TurnCollector(randomUUID(), MODELS.auditor, request.tools);
    const result = streamText({
      model: auditorModel(),
      system,
      messages,
      tools,
      toolChoice: toToolChoice(request, tools),
      maxOutputTokens: 4096,
      abortSignal: req.signal,
      // Thinking off: answers stay quick on camera, and no thinking blocks need carrying through Studio's history.
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
        send({ complete: collector.response() });
        controller.close();
      },
    });
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (err) {
    return handleRouteError(err, "ops/ask");
  }
}
