// API routes return `{ ok, data | error }` and zod-validate every input (AGENTS.md §11).
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { PayPalError } from "@/lib/paypal/client";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(error: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "body must be JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, `invalid body: ${parsed.error.issues.map((i) => `${i.path.join(".") || "root"} ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

/** Maps known error types to responses; logs and hides everything else. */
export function handleRouteError(err: unknown, context: string): NextResponse {
  if (err instanceof HttpError) return fail(err.message, err.status);
  if (err instanceof ZodError) return fail(`validation failed: ${err.message}`, 400);
  if (err instanceof PayPalError) {
    console.error(`[${context}] PayPal error`, err.status, err.debugId, err.body);
    return fail(err.message, 502, { paypalDebugId: err.debugId });
  }
  console.error(`[${context}]`, err);
  return fail("internal error", 500);
}
