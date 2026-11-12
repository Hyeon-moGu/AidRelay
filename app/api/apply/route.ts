import { ApplicationSchema, readForm, readMultipart, submitApplication } from "@/lib/intake";
import { fail, handleRouteError, HttpError, ok } from "@/lib/http";
import { MESSAGES } from "@/lib/i18n/messages";
import { clientIp, LIMITS, takeSlots } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { fields, photos, docs } = await readMultipart(await readForm(req));
    const parsed = ApplicationSchema.safeParse(fields);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".") || "field"}: ${i.message}`).join("; "));
    }
    // Every application is reviewed by a paid model, so the route counts them before it takes one in: per
    // client and for the whole site (lib/rate-limit.ts). A form with a mistake in it is not counted.
    const slot = await takeSlots([
      { name: "apply-ip", key: clientIp(req), windows: LIMITS.applyPerIp },
      { name: "apply-all", key: "all", windows: LIMITS.applyAll },
    ]);
    if (!slot.ok) {
      const errors = MESSAGES[parsed.data.lang].apply.errors;
      return fail(slot.bucket === "apply-all" ? errors.tooManyAll : errors.tooManyMine, 429, { retryAfterSec: slot.retryAfterSec });
    }
    const result = await submitApplication(parsed.data, photos, docs);
    return ok(result, { status: 201 });
  } catch (err) {
    return handleRouteError(err, "apply");
  }
}
