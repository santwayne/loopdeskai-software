import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerBusiness } from "@/lib/session";
import { logEvent } from "@/lib/logger";
import { parsePlanKey } from "@/lib/hub/customer-plans";

const schema = z.object({ plan: z.string().max(60) });

/**
 * POST /api/billing/request { plan: "GROW" | "bundle:<id>" } — the owner asks
 * for a plan. No payment here: our team activates it (Admin → Bundles).
 * Before anything is active the pick also becomes the account's plan, so the
 * home page shows the right tools; once active it waits as a change request.
 */
export async function POST(req: NextRequest) {
  const business = await getOwnerBusiness();
  if (!business) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (business.status === "SUSPENDED") return NextResponse.json({ error: "This account is suspended" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  const picked = parsed.success ? parsePlanKey(parsed.data.plan) : null;
  if (!picked) return NextResponse.json({ error: "Choose a plan." }, { status: 400 });

  let key: string;
  let bundleId: string | null = null;
  if ("bundleId" in picked) {
    const bundle = await prisma.bundle.findFirst({ where: { id: picked.bundleId, active: true, showToCustomers: true }, select: { id: true } });
    if (!bundle) return NextResponse.json({ error: "That plan isn't available any more." }, { status: 400 });
    bundleId = bundle.id;
    key = `bundle:${bundle.id}`;
  } else {
    key = picked.builtIn;
  }

  const notStarted = business.bundleStatus === "NONE" || business.bundleStatus === "PENDING_PAYMENT";
  await prisma.business.update({
    where: { id: business.id },
    data: {
      planRequest: key, planRequestedAt: new Date(),
      ...(notStarted ? {
        bundleStatus: "PENDING_PAYMENT",
        ...(bundleId ? { customBundleId: bundleId, frontDeskPlan: null, bundleTools: "" } : { customBundleId: null, frontDeskPlan: key, bundleTools: "" }),
      } : {}),
    },
  });
  await logEvent({ businessId: business.id, source: "BILLING", level: "INFO", message: `Owner asked for plan ${key}: activate it in Admin → Bundles` });
  return NextResponse.json({ ok: true, plan: key });
}
