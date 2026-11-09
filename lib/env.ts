// Server-only. Never import this from a client component: it exposes secrets.
// Mirrors .env.example.
import { z } from "zod";

const EnvSchema = z.object({
  // Live money is out of scope; the schema refuses anything but sandbox.
  PAYPAL_ENV: z.literal("sandbox").default("sandbox"),
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  /** Set once the webhook exists (needs a public URL). Until then the webhook route answers 503 and everything else runs. */
  PAYPAL_WEBHOOK_ID: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().min(1),

  FIREBASE_PROJECT_ID: z.string().min(1),
  /**
   * Path to a service-account JSON key. Optional: leave it empty to use Application Default Credentials.
   * `gcloud auth application-default login` on a laptop, or the service account attached to the Cloud Run service.
   */
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  GCS_BUCKET: z.string().min(1),

  APP_URL: z.url(),
  ADMIN_PASSWORD: z.string().min(8),
  AGENT_INTERNAL_SECRET: z.string().min(16),

  // Whole dollars in the environment; money is integer cents everywhere else.
  AUTO_APPROVE_LIMIT: z.coerce.number().int().positive().default(250),
  AUTO_APPROVE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.85),
  /** P-9.9: a second independent evaluation must agree before the agent pays on its own. */
  AUTO_APPROVE_DOUBLE_CHECK: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  FUND_ID: z.string().min(1).default("default"),

  /**
   * Demo setting. "true": anyone may look at /ops (queue, case panel, activity feed) with contact details hidden;
   * every action still needs the operator login. "false": the whole console sits behind the login, as a real fund runs it.
   */
  OPS_PUBLIC_VIEW: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

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
