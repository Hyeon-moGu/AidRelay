import { readForm, readMultipart, ReplySchema, submitReply } from "@/lib/intake";
import { handleRouteError, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const { fields, photos, docs } = await readMultipart(await readForm(req));
    const { text } = ReplySchema.parse(fields);
    const c = await submitReply(token, text, photos, docs);
    return ok({ id: c.id, status: c.status });
  } catch (err) {
    return handleRouteError(err, "status/reply");
  }
}
