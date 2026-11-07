// Streams a private applicant photo to a signed-in operator. No signed URLs needed (works with or without a key file).
import { fail, handleRouteError } from "@/lib/http";
import { isOperator } from "@/lib/ops/auth";
import { downloadObject } from "@/lib/storage/gcs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    if (!(await isOperator())) return fail("sign in first", 401);
    const path = new URL(req.url).searchParams.get("path") ?? "";
    if (!/^cases\/[A-Za-z0-9-]+\/(photo|doc)-\d+\.jpg$/.test(path)) return fail("bad path", 400);
    const data = await downloadObject(path);
    return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    return handleRouteError(err, "ops/photo");
  }
}
