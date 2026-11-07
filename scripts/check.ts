// pnpm check — verifies every external service in .env without moving money.
// Each check builds its own client from process.env so a missing GCP value never hides a PayPal result.
try {
  process.loadEnvFile();
} catch {
  // rely on the environment when there is no .env
}

type Result = { name: string; status: "PASS" | "FAIL" | "SKIP"; detail: string };
const results: Result[] = [];
const env = process.env;

function missing(keys: string[]): string[] {
  return keys.filter((k) => !env[k]);
}

async function step(name: string, needs: string[], fn: () => Promise<string>) {
  const gaps = missing(needs);
  if (gaps.length) {
    results.push({ name, status: "SKIP", detail: `fill ${gaps.join(", ")} in .env` });
    return;
  }
  try {
    results.push({ name, status: "PASS", detail: await fn() });
  } catch (err) {
    results.push({ name, status: "FAIL", detail: err instanceof Error ? err.message.split("\n")[0].slice(0, 220) : String(err) });
  }
}

const PAYPAL = "https://api-m.sandbox.paypal.com";

async function paypalToken(): Promise<string> {
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`token request failed (${res.status}): ${json.error_description ?? "check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET"}`);
  return json.access_token;
}

async function main() {
  await step("env", [], async () => {
    const { z } = await import("zod");
    const { getEnv } = await import("@/lib/env");
    try {
      const e = getEnv();
      return `all required variables present (fund ${e.FUND_ID}, auto-approve $${e.AUTO_APPROVE_LIMIT}, double-check ${e.AUTO_APPROVE_DOUBLE_CHECK})`;
    } catch (err) {
      if (err instanceof z.ZodError) {
        const keys = [...new Set(err.issues.map((i) => String(i.path[0])))];
        throw new Error(`still missing or invalid: ${keys.join(", ")}`);
      }
      throw err;
    }
  });

  await step("paypal", ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"], async () => {
    const token = await paypalToken();
    if (env.NEXT_PUBLIC_PAYPAL_CLIENT_ID && env.NEXT_PUBLIC_PAYPAL_CLIENT_ID !== env.PAYPAL_CLIENT_ID) {
      throw new Error("NEXT_PUBLIC_PAYPAL_CLIENT_ID differs from PAYPAL_CLIENT_ID; they must be the same app");
    }
    // An empty body never creates a batch: 400 means the Payouts permission was passed, 403 means it is off.
    const res = await fetch(`${PAYPAL}/v1/payments/payouts`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
    if (res.status === 403) throw new Error("token ok but Payouts is NOT enabled on the app (Apps & Credentials → Features → Payouts)");
    if (res.status !== 400) throw new Error(`unexpected ${res.status} from the Payouts probe`);
    return "token ok; Payouts enabled";
  });

  await step("paypal webhooks", ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID"], async () => {
    const token = await paypalToken();
    const res = await fetch(`${PAYPAL}/v1/notifications/webhooks`, { headers: { Authorization: `Bearer ${token}` } });
    const json = (await res.json()) as { webhooks?: Array<{ id: string; url: string; event_types?: Array<{ name: string }> }> };
    const hooks = json.webhooks ?? [];
    const mine = hooks.find((h) => h.id === env.PAYPAL_WEBHOOK_ID);
    if (!mine) {
      throw new Error(hooks.length ? `PAYPAL_WEBHOOK_ID matches none of: ${hooks.map((h) => `${h.id} → ${h.url}`).join("; ")}` : "no webhook registered for this app yet");
    }
    return `${mine.id} → ${mine.url} (${mine.event_types?.length ?? 0} event types)`;
  });

  await step("firestore", ["FIREBASE_PROJECT_ID", "GOOGLE_APPLICATION_CREDENTIALS"], async () => {
    const { applicationDefault, getApps, initializeApp } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId: env.FIREBASE_PROJECT_ID });
    const ref = getFirestore(app).collection("_health").doc(`check-${Date.now()}`);
    await ref.set({ at: new Date().toISOString() });
    const snap = await ref.get();
    await ref.delete();
    if (!snap.exists) throw new Error("wrote a document but could not read it back");
    return `project ${env.FIREBASE_PROJECT_ID}: write, read and delete ok`;
  });

  await step("gcs", ["GCS_BUCKET", "FIREBASE_PROJECT_ID", "GOOGLE_APPLICATION_CREDENTIALS"], async () => {
    const { Storage } = await import("@google-cloud/storage");
    const file = new Storage({ projectId: env.FIREBASE_PROJECT_ID }).bucket(env.GCS_BUCKET!).file(`_health/check-${Date.now()}.txt`);
    await file.save(Buffer.from("ok"), { contentType: "text/plain", resumable: false });
    const [back] = await file.download();
    await file.delete();
    if (back.toString() !== "ok") throw new Error("uploaded object read back with different content");
    return `bucket ${env.GCS_BUCKET}: upload, download and delete ok`;
  });

  await step("anthropic", ["ANTHROPIC_API_KEY"], async () => {
    const { generateText } = await import("ai");
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const { MODELS } = await import("@/lib/agent/models");
    const model = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(MODELS.prescreen);
    const r = await generateText({ model, prompt: "Reply with the single word OK." });
    return `${MODELS.prescreen} answered "${r.text.trim().slice(0, 20)}" (${r.usage.inputTokens ?? 0} in / ${r.usage.outputTokens ?? 0} out tokens)`;
  });

  let failed = 0;
  for (const r of results) {
    if (r.status === "FAIL") failed++;
    console.log(`${r.status}  ${r.name.padEnd(16)} ${r.detail}`);
  }
  const skipped = results.filter((r) => r.status === "SKIP").length;
  console.log(failed ? `\n${failed} check(s) failed${skipped ? `, ${skipped} skipped` : ""}` : skipped ? `\nno failures, ${skipped} check(s) skipped` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
