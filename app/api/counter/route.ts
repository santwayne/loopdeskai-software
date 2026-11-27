import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentMember } from "@/lib/session";
import { ingestEvents } from "@/lib/ingest-events";
import { normalizePhone } from "@/lib/pos";
import { counterNotes } from "@/lib/counter-notes";
import { TIER_LABEL, pointsValueRupees } from "@/lib/loyalty";
import { confirmRedeem, customerTier, ensureReferralCode, startRedeem, walletTopup } from "@/lib/loyalty-db";

/**
 * The counter screen (Restaurant Bundle phase 2) for outlets without a POS
 * link, and for redeeming at any outlet. Owner and managers.
 *
 * GET  /api/counter?phone=98…&locationId=…  → the customer's points, wallet, tier
 * POST /api/counter { action: "bill" | "redeem" | "confirm" | "topup", … }
 */

async function context(locationId: string | null | undefined) {
  const member = await getCurrentMember();
  if (!member) return null;
  const locations = await prisma.location.findMany({ where: { businessId: member.business.id }, orderBy: { createdAt: "asc" } });
  const location = locations.find((l) => l.id === locationId) ?? locations[0];
  if (!location) return null;
  return { ...member, location, locations };
}

function phoneFor(raw: string, country: string) {
  return normalizePhone(raw, country === "CA" || country === "US" ? "1" : "91");
}

async function summary(business: Parameters<typeof customerTier>[0], customerId: string) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  const tier = await customerTier(business, c.id);
  return {
    id: c.id, name: c.name, phone: c.phone, visits: c.visitCount, points: c.points,
    pointsValue: pointsValueRupees(c.points, business), walletRupees: c.walletPaise / 100,
    tier: TIER_LABEL[tier], referralCode: business.loyaltyEnabled ? await ensureReferralCode(c) : null,
  };
}

export async function GET(req: NextRequest) {
  const ctx = await context(req.nextUrl.searchParams.get("locationId"));
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const phone = phoneFor(req.nextUrl.searchParams.get("phone") ?? "", ctx.business.country);
  if (!phone) return NextResponse.json({ error: "Enter a valid mobile number." }, { status: 400 });
  const c = await prisma.customer.findUnique({ where: { locationId_phone: { locationId: ctx.location.id, phone } } });
  return NextResponse.json({ customer: c ? await summary(ctx.business, c.id) : null, loyalty: ctx.business.loyaltyEnabled });
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("bill"), locationId: z.string().optional(), phone: z.string(), name: z.string().trim().max(100).optional(), amount: z.number().min(0).max(1_000_000), billNo: z.string().trim().max(40).optional(), key: z.string().min(8).max(60) }),
  z.object({ action: z.literal("redeem"), locationId: z.string().optional(), phone: z.string(), kind: z.enum(["POINTS", "WALLET"]), amount: z.number().positive() }),
  z.object({ action: z.literal("confirm"), requestId: z.string(), code: z.string().regex(/^\d{6}$/, "The code has 6 digits.") }),
  z.object({ action: z.literal("topup"), locationId: z.string().optional(), phone: z.string(), amount: z.number().positive().max(100_000), note: z.string().trim().max(100).optional() }),
]);

export async function POST(req: NextRequest) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
  const p = parsed.data;
  const ctx = await context("locationId" in p ? p.locationId : null);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { business, location, locations, user } = ctx;

  if (p.action === "confirm") {
    const r = await confirmRedeem(business, p.requestId, p.code, user.id);
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 400 });
  }

  const phone = phoneFor(p.phone, business.country);
  if (!phone) return NextResponse.json({ error: "Enter a valid mobile number." }, { status: 400 });

  if (p.action === "bill") {
    // key: made by the browser per bill, so a double tap never counts twice.
    const externalId = p.billNo ? `counter:${location.id}:${p.billNo}` : `counter:${p.key}`;
    const result = await ingestEvents({ ...business, locations }, [{ type: "VISIT", phone, name: p.name || undefined, amount: p.amount, externalId, locationId: location.id }], `counter:${user.id}`);
    const r = result.results[0];
    if (r.status === "rejected") return NextResponse.json({ error: r.error }, { status: 400 });
    // Points for exactly this bill (not just the latest EARN row).
    const visit = await prisma.visit.findUnique({ where: { businessId_externalId: { businessId: business.id, externalId } }, select: { id: true } });
    const earned = visit ? await prisma.loyaltyEntry.findUnique({ where: { visitId: visit.id }, select: { points: true } }) : null;
    // Testing bugs 4 + 5: say plainly why points / the rating message don't show up.
    const fresh = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    return NextResponse.json({
      status: r.status,
      earned: r.status === "duplicate" ? 0 : earned?.points ?? 0,
      notes: counterNotes(fresh, { amount: p.amount, pointsAwarded: !!earned }),
      customer: await summary(fresh, r.customerId),
    });
  }

  const customer = await prisma.customer.findUnique({ where: { locationId_phone: { locationId: location.id, phone } } });
  if (!customer) return NextResponse.json({ error: "No customer with this number at this outlet yet. Record a bill first." }, { status: 404 });

  if (p.action === "redeem") {
    const amount = p.kind === "WALLET" ? Math.round(p.amount * 100) : Math.round(p.amount);
    const r = await startRedeem(business, location, customer, p.kind, amount, user.id);
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 400 });
  }

  const r = await walletTopup(business, customer, Math.round(p.amount * 100), user.id, location.id, p.note);
  return r.ok ? NextResponse.json({ ...r, customer: await summary(business, customer.id) }) : NextResponse.json({ error: r.error }, { status: 400 });
}
