import { z } from "zod";
import { createDonationRecord } from "@/lib/db/repos/donations";
import { getFund } from "@/lib/db/repos/fund";
import { handleRouteError, ok, parseJson } from "@/lib/http";
import { createDonationOrder } from "@/lib/paypal/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// $1 – $10,000 per donation (sandbox).
const Body = z.object({ amountCents: z.number().int().min(100).max(1_000_000) });

export async function POST(req: Request) {
  try {
    const { amountCents } = await parseJson(req, Body);
    const fund = await getFund();
    const order = await createDonationOrder({
      amountCents,
      currency: fund.currency,
      fundId: fund.id,
      description: `Donation to ${fund.name} (sandbox)`,
    });
    await createDonationRecord({ orderId: order.id, amountCents, currency: fund.currency });
    return ok({ orderId: order.id, amountCents, currency: fund.currency });
  } catch (err) {
    return handleRouteError(err, "donate/create-order");
  }
}
