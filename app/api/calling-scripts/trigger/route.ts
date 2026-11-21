import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerBusiness } from "@/lib/session";
import { isInstagramOnly } from "@/lib/instagram-shared";

const schema = z.object({ scriptId: z.string(), customerId: z.string() });

export async function POST(req: NextRequest) {
  const business = await getOwnerBusiness();
  if (!business) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (business.status === "SUSPENDED") {
    return NextResponse.json({ error: "This business account is suspended" }, { status: 403 });
  }
  // Loopdesk bundle clients call from Calls (WayneRing), never from here (H8).
  if (business.bundleStatus !== "NONE") {
    return NextResponse.json({ error: "Calls go through Loopdesk AI Calls. Open Calls from your home screen." }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "scriptId and customerId required" }, { status: 400 });
  }

  const [script, customer] = await Promise.all([
    prisma.callingScript.findFirst({ where: { id: parsed.data.scriptId, businessId: business.id } }),
    prisma.customer.findFirst({ where: { id: parsed.data.customerId, businessId: business.id } }),
  ]);
  if (!script || !customer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (customer.optedOut) {
    return NextResponse.json(
      { error: "Customer has opted out of WhatsApp/calling outreach" },
      { status: 409 }
    );
  }
  if (isInstagramOnly(customer)) {
    return NextResponse.json({ error: "This customer has only messaged on Instagram — there is no phone number to call." }, { status: 409 });
  }

  // All calling goes through WayneRing (bundle rule, Nov 2026). This app never
  // dials on its own: the script is saved for the owner to call by hand.
  const status = "PENDING" as const;
  const callLog = await prisma.callLog.create({
    data: {
      businessId: business.id,
      customerId: customer.id,
      scriptId: script.id,
      generatedContent: script.content,
      status,
    },
  });

  return NextResponse.json({ callLog, providerConfigured: false });
}
