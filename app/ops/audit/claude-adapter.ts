// The AgLlmAdapter AG Studio's Agent Framework calls for every model turn. It holds no key and no provider
// logic: it posts Studio's request to /api/ops/ask (operators only), which answers with Claude, and turns the
// newline-delimited JSON reply back into Studio's event stream and final response.
// A visitor of the open demo (`canAsk: false`) may look at the auditor but not ask: their question is answered
// here with the reason, as an ordinary reply in the chat, and no request is sent.
import type { AgAiEvent, AgLlmAdapter, AgLlmResponse } from "ag-studio";

/** What a visitor reads when they ask. Every question is a paid model call, so the demo keeps asking for signed-in staff. */
export const SIGN_IN_TO_ASK =
  "Asking the ledger needs the staff sign-in, because every question is a real call to the model. Sign in at /ops/login (the password is in the Devpost testing instructions), then ask again. You can still explore the report and add charts by hand.";

function failed(message: string, status: AgLlmResponse["status"] = "failed"): AgLlmResponse {
  return { id: crypto.randomUUID(), createdAt: Date.now(), output: [], status, error: { code: status === "cancelled" ? "cancelled" : "adapter_error", message } };
}

/** A turn that never reaches the model: `text` as a finished assistant message, in the events and the response Studio expects. */
function replied(text: string): { events: AgAiEvent[]; response: AgLlmResponse } {
  const id = crypto.randomUUID();
  const messageId = `${id}:0`;
  return {
    events: [
      { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId, delta: text },
      { type: "TEXT_MESSAGE_END", messageId },
    ],
    response: {
      id,
      createdAt: Date.now(),
      status: "completed",
      output: [{ id: `msg_${id}`, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] }],
    },
  };
}

export function claudeAdapter(endpoint: string, opts: { canAsk?: boolean } = {}): AgLlmAdapter {
  const canAsk = opts.canAsk ?? true;
  return {
    executeTurn(request, options) {
      const queue: AgAiEvent[] = [];
      let finished = false;
      let wake: (() => void) | null = null;
      let resolveComplete!: (r: AgLlmResponse) => void;
      const complete = new Promise<AgLlmResponse>((resolve) => (resolveComplete = resolve));

      const push = (event: AgAiEvent) => {
        queue.push(event);
        wake?.();
      };
      const finish = (response: AgLlmResponse) => {
        if (finished) return;
        finished = true;
        resolveComplete(response);
        wake?.();
      };

      void (async () => {
        if (!canAsk) {
          const notice = replied(SIGN_IN_TO_ASK);
          notice.events.forEach(push);
          return finish(notice.response);
        }
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
            signal: options?.signal,
          });
          if (res.status === 401) return finish(failed("Your staff session has ended. Sign in again at /ops/login, then come back to Ask the ledger."));
          if (res.status === 429) return finish(failed("The auditor has answered a lot of questions in the last few minutes. Please try again shortly."));
          if (res.status === 413) return finish(failed("This conversation has grown too long. Start a new chat."));
          if (!res.ok || !res.body) return finish(failed(`The model endpoint answered ${res.status}.`));
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let newline: number;
            while ((newline = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, newline).trim();
              buffer = buffer.slice(newline + 1);
              if (!line) continue;
              const message = JSON.parse(line) as { event?: AgAiEvent; complete?: AgLlmResponse };
              if (message.event) push(message.event);
              if (message.complete) {
                finish(message.complete);
                // The turn is over: release the connection now rather than leaving it to be aborted later.
                void reader.cancel().catch(() => undefined);
                return;
              }
            }
          }
          finish(failed("The model stream ended before the turn finished."));
        } catch (err) {
          const aborted = options?.signal?.aborted || (err instanceof DOMException && err.name === "AbortError");
          finish(aborted ? failed("Cancelled.", "cancelled") : failed(err instanceof Error ? err.message : String(err)));
        }
      })();

      const stream = {
        async *[Symbol.asyncIterator](): AsyncIterator<AgAiEvent> {
          for (;;) {
            if (queue.length > 0) {
              yield queue.shift()!;
              continue;
            }
            if (finished) return;
            await new Promise<void>((resolve) => (wake = resolve));
            wake = null;
          }
        },
      };
      return { stream, complete };
    },
  };
}
