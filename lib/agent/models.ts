// Model wiring (AGENTS.md §2): Sonnet for the agent loop and decisions, Haiku for the cheap pre-screen.
import { createAnthropic } from "@ai-sdk/anthropic";
import { getEnv } from "@/lib/env";

export const MODELS = {
  officer: "claude-sonnet-5-5",
  prescreen: "claude-haiku-5-5",
} as const;

let provider: ReturnType<typeof createAnthropic> | undefined;

/** Pinned so a stray ANTHROPIC_BASE_URL in the shell (Claude Code sets one without /v1) cannot redirect the provider. */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

function anthropic() {
  provider ??= createAnthropic({ apiKey: getEnv().ANTHROPIC_API_KEY, baseURL: ANTHROPIC_BASE_URL });
  return provider;
}

export function officerModel() {
  return anthropic()(MODELS.officer);
}

export function prescreenModel() {
  return anthropic()(MODELS.prescreen);
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
}

export function addUsage(total: Usage, u: { inputTokens?: number; outputTokens?: number } | undefined): void {
  total.inputTokens += u?.inputTokens ?? 0;
  total.outputTokens += u?.outputTokens ?? 0;
  total.modelCalls += 1;
}
