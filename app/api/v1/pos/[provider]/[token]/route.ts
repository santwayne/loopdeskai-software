import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logger";
import { ingestEvents } from "@/lib/ingest-events";
import { POS_PROVIDERS, billToEvent, parsePos, type PosProvider } from "@/lib/pos";

/**
 * POST /api/v1/pos/<provider>/<posToken> — one bill from a POS (Restaurant
 * Bundle phase 2). The token is one outlet's secret from Settings → POS sync;
 * it decides the business and the outlet. Petpooja's team pastes this URL
 * into their webhook settings; any other POS can use provider "generic":
 *   { "orderId": "B-1042", "phone": "9876543210", "name": "Simran",
 *     "amount": 640, "occurredAt": "2026-11-23T13:45:00+05:30" }
 *
 * Always answers 200 for bills it understood or chose to skip (cancelled,
 * no phone), so the POS doesn't retry or disable the webhook; 4xx only for a
 * bad token or a payload it can't read.
 */
export async function POST(req: NextRequest, { params }: { params: { provider: string; token: string } }) {
  const provider = params.provider.toLowerCase() as PosProvider;
  if (!POS_PROVIDERS.includes(provider)) return NextResponse.json({ error: "Unknown POS provider" }, { status: 404 });
  if (!/^pos_[a-f0-9]{36}$/.test(params.token)) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const location = await prisma.location.findUnique({
    where: { posToken: params.token },
    include: { business: { include: { locations: { select: { id: true, name: true, status: true } } } } },
  });
  if (!location || location.posProvider !== provider) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const business = location.business;
  if (business.status === "SUSPENDED" || location.status === "SUSPENDED") return NextResponse.json({ ok: true, skipped: "suspended" });

  const body = await req.json().catch(() => null);
  const parsed = parsePos(provider, body);
  if (!parsed.ok) {
    if (parsed.reason === "IGNORED") return NextResponse.json({ ok: true, skipped: parsed.error });
    await logEvent({ businessId: business.id, source: "POS", level: "WARN", message: `POS bill not understood (${provider}): ${parsed.error}`, meta: { locationId: location.id } });
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  // A token belongs to one outlet; a bill for a different Petpooja restaurant is refused.
  if (location.posRestId && parsed.bill.restId && parsed.bill.restId !== location.posRestId) {
    await logEvent({ businessId: business.id, source: "POS", level: "WARN", message: `POS bill for restaurant ${parsed.bill.restId}, outlet is set to ${location.posRestId}`, meta: { locationId: location.id } });
    return NextResponse.json({ error: "This bill is for a different outlet" }, { status: 409 });
  }

  const result = await ingestEvents(business, [billToEvent(provider, parsed.bill, location.id)], `pos:${provider}`);
  const r = result.results[0];
  if (r?.status === "rejected") {
    await logEvent({ businessId: business.id, source: "POS", level: "WARN", message: `POS bill rejected: ${r.error}`, meta: { locationId: location.id, orderId: parsed.bill.orderId } });
    return NextResponse.json({ ok: true, skipped: r.error });
  }
  return NextResponse.json({ ok: true, status: r?.status, orderId: parsed.bill.orderId });
}
