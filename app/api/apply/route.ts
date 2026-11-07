import { ApplicationSchema, readMultipart, submitApplication } from "@/lib/intake";
import { handleRouteError, HttpError, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { fields, photos, docs } = await readMultipart(await req.formData());
    const parsed = ApplicationSchema.safeParse(fields);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".") || "field"}: ${i.message}`).join("; "));
    }
    const result = await submitApplication(parsed.data, photos, docs);
    return ok(result, { status: 201 });
  } catch (err) {
    return handleRouteError(err, "apply");
  }
}
