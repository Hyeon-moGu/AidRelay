// Model wiring: Sonnet for the agent loop and decisions, Haiku for the cheap pre-screen.
import { createAnthropic } from "@ai-sdk/anthropic";
import { getEnv } from "@/lib/env";

export const MODELS = {
  officer: "claude-sonnet-5-5",
  prescreen: "claude-haiku-5-5",
  /** The /ops ledger auditor (AG Studio Agent Framework): quick, read-only questions over anonymized tables. */
  auditor: "claude-haiku-5-5",
} as const;

/** Pinned so a stray ANTHROPIC_BASE_URL in the shell (some tools export one without /v1) cannot redirect the provider. */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

let provider: ReturnType<typeof createAnthropic> | undefined;

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

export function auditorModel() {
  return anthropic()(MODELS.auditor);
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache hits (the policy text). Visible in the activity feed so cache misses are noticed. */
  cachedInputTokens: number;
  modelCalls: number;
}

export function newUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, modelCalls: 0 };
}

/** Adds one call's tokens. A tool-using session makes one model request per step: pass `calls` = its steps. */
export function addUsage(
  total: Usage,
  u: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } | undefined,
  calls = 1,
): void {
  total.inputTokens += u?.inputTokens ?? 0;
  total.outputTokens += u?.outputTokens ?? 0;
  total.cachedInputTokens += u?.cachedInputTokens ?? 0;
  total.modelCalls += calls;
}
