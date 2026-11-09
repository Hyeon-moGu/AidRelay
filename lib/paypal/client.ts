// Server-only PayPal REST client. All secret-bearing PayPal calls live under lib/paypal/*.
import { getEnv } from "@/lib/env";

const BASE_URL = {
  sandbox: "https://api-m.sandbox.paypal.com",
} as const;

export function paypalBaseUrl(): string {
  return BASE_URL[getEnv().PAYPAL_ENV];
}

export class PayPalError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    public readonly debugId?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

/**
 * Every PayPal call gives up after this long. Node's fetch has no timeout of its own (it waits minutes for
 * response headers), and a payout attempt must be over well before an operator may send it again
 * (STALE_CREATING_MS in lib/db/repos/payouts.ts).
 */
export const PAYPAL_TIMEOUT_MS = 30_000;

let tokenCache: { token: string; expiresAt: number } | undefined;

/** Client-credentials access token, cached until a minute before expiry. */
export async function getAccessToken(force = false): Promise<string> {
  if (!force && tokenCache && tokenCache.expiresAt - Date.now() > 60_000) return tokenCache.token;
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = getEnv();
  const basic = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
    signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
  });
  const body = await readBody(res);
  if (!res.ok) {
    throw new PayPalError(`PayPal token request failed (${res.status})`, res.status, body, debugId(res));
  }
  const json = body as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export interface PayPalRequest {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Sent as `PayPal-Request-Id` so retries of the same logical call are idempotent on PayPal's side. */
  requestId?: string;
  headers?: Record<string, string>;
}

/** JSON call against the PayPal REST API. Throws PayPalError on non-2xx; retries once on 401 with a fresh token. */
export async function paypalFetch<T>(path: string, init: PayPalRequest = {}, attempt = 0): Promise<T> {
  const token = await getAccessToken(attempt > 0);
  const method = init.method ?? "GET";
  const res = await fetch(`${paypalBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
  });
  if (res.status === 401 && attempt === 0) return paypalFetch<T>(path, init, 1);
  const body = await readBody(res);
  if (!res.ok) {
    throw new PayPalError(`PayPal ${method} ${path} failed (${res.status})`, res.status, body, debugId(res));
  }
  return body as T;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function debugId(res: Response): string | undefined {
  return res.headers.get("paypal-debug-id") ?? undefined;
}
