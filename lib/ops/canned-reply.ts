// A finished assistant turn that never reached the model, in the shape AG Studio's Agent Framework expects:
// the events it streams into the chat and the final response. Used in the browser (a visitor's question)
// and on the server (a question the ledger auditor will not take). No imports, so it runs in both.
import type { AgAiEvent, AgLlmResponse } from "ag-studio";

export function cannedTurn(text: string): { events: AgAiEvent[]; response: AgLlmResponse } {
  const id = globalThis.crypto.randomUUID();
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
