// Webhook signature verification: every event is verified with PayPal before it is processed.
import { getEnv } from "@/lib/env";
import { paypalFetch } from "@/lib/paypal/client";

export interface PayPalWebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
}

export function readWebhookHeaders(h: Headers): PayPalWebhookHeaders | null {
  const transmissionId = h.get("paypal-transmission-id");
  const transmissionTime = h.get("paypal-transmission-time");
  const certUrl = h.get("paypal-cert-url");
  const authAlgo = h.get("paypal-auth-algo");
  const transmissionSig = h.get("paypal-transmission-sig");
  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) return null;
  return { transmissionId, transmissionTime, certUrl, authAlgo, transmissionSig };
}

/** POST /v1/notifications/verify-webhook-signature. `rawBody` must be the exact bytes PayPal sent. */
export function webhookConfigured(): boolean {
  return !!getEnv().PAYPAL_WEBHOOK_ID;
}

export async function verifyWebhookSignature(
  headers: PayPalWebhookHeaders,
  rawBody: string,
): Promise<boolean> {
  if (!webhookConfigured()) throw new Error("PAYPAL_WEBHOOK_ID is not set");
  const res = await paypalFetch<{ verification_status: "SUCCESS" | "FAILURE" }>(
    "/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      body: {
        auth_algo: headers.authAlgo,
        cert_url: headers.certUrl,
        transmission_id: headers.transmissionId,
        transmission_sig: headers.transmissionSig,
        transmission_time: headers.transmissionTime,
        webhook_id: getEnv().PAYPAL_WEBHOOK_ID,
        webhook_event: JSON.parse(rawBody),
      },
    },
  );
  return res.verification_status === "SUCCESS";
}
