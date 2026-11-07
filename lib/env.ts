// Server-only. Never import this from a client component: it exposes secrets.
// Mirrors .env.example and AGENTS.md §7.
import { z } from "zod";

const EnvSchema = z.object({
  // Live money is out of scope (AGENTS.md §10); the schema refuses anything but sandbox.
  PAYPAL_ENV: z.literal("sandbox").default("sandbox"),
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_WEBHOOK_ID: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().min(1),

  FIREBASE_PROJECT_ID: z.string().min(1),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1),
  GCS_BUCKET: z.string().min(1),

  APP_URL: z.url(),
  ADMIN_PASSWORD: z.string().min(8),
  AGENT_INTERNAL_SECRET: z.string().min(16),

  // Whole dollars in the environment; money is integer cents everywhere else (AGENTS.md §11).
  AUTO_APPROVE_LIMIT: z.coerce.number().int().positive().default(250),
  AUTO_APPROVE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.85),
  FUND_ID: z.string().min(1).default("default"),

  AG_GRID_LICENSE_KEY: z.string().optional(),
  AG_STUDIO_LICENSE_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Parses process.env once; throws with a readable list of missing variables. */
export function getEnv(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

export function autoApproveLimitCents(): number {
  return getEnv().AUTO_APPROVE_LIMIT * 100;
}
