import { readForm, readMultipart, ReplySchema, submitReply } from "@/lib/intake";
import { fail, handleRouteError, ok } from "@/lib/http";
import { MESSAGES, normalizeLang } from "@/lib/i18n/messages";
import { clientIp, LIMITS, takeSlots } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const { fields, photos, docs } = await readMultipart(await readForm(req));
    const { text } = ReplySchema.parse(fields);
    // A reply sends the case back to the model, so it is counted like a new application (lib/rate-limit.ts).
    const slot = await takeSlots([
      { name: "reply-ip", key: clientIp(req), windows: LIMITS.replyPerIp },
      { name: "reply-all", key: "all", windows: LIMITS.replyAll },
    ]);
    if (!slot.ok) {
      const errors = MESSAGES[normalizeLang(fields.lang)].apply.errors;
      return fail(slot.bucket === "reply-all" ? errors.tooManyAll : errors.tooManyMine, 429, { retryAfterSec: slot.retryAfterSec });
    }
    const c = await submitReply(token, text, photos, docs);
    return ok({ id: c.id, status: c.status });
  } catch (err) {
    return handleRouteError(err, "status/reply");
  }
}
