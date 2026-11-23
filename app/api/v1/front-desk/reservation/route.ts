import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiKey } from "@/lib/api-keys";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { upsertCustomer } from "@/lib/front-desk";
import { senderName } from "@/lib/sms";
import { sendCustomerWhatsApp, sendOwnerWhatsApp, ownerWhatsAppSender } from "@/lib/whatsapp-send";
import { getSettings } from "@/lib/growth/settings";
import { ownerPhoneFor } from "@/lib/growth/brief";
import { ingestGrowthEvents } from "@/lib/growth/events";
import { reservationLine } from "@/lib/restaurant";

/**
 * POST /api/v1/front-desk/reservation — the AI receptionist booked a table
 * or took a takeaway order on a call (Restaurant Bundle phase 3). Same API
 * keys as /api/v1/events. Saves it, sends the caller a WhatsApp confirmation
 * (reservation_confirm), tells the owner, and puts a BOOKING on the Growth
 * timeline. One reservation per callId.
 *
 * Body: { "phone": "+919876543210", "name": "Simran", "kind": "TABLE",
 *         "partySize": 4, "at": "2026-11-28T21:00:00+05:30", "callId": "plivo:…" }
 *       takeaway: { "kind": "TAKEAWAY", "items": "2 taro boba, 1 brownie", "at": "…" }
 */
const schema = z.object({
  phone: z.string().min(5),
  name: z.string().trim().max(100).optional(),
  kind: z.enum(["TABLE", "TAKEAWAY"]),
  partySize: z.number().int().min(1).max(100).optional(),
  at: z.string().datetime({ offset: true }),
  items: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(500).optional(),
  callId: z.string().max(200).optional(),
  locationId: z.string().optional(),
}).refine((r) => r.kind === "TAKEAWAY" || r.partySize != null, "partySize is required for a table")
  .refine((r) => r.kind === "TABLE" || !!r.items, "items are required for a takeaway order");

export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 });
  if (auth.suspended) return NextResponse.json({ error: "Business is suspended" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  const p = parsed.data;
  const at = new Date(p.at);
  const now = new Date();
  if (at.getTime() < now.getTime() - 15 * 60_000 || at.getTime() > now.getTime() + 60 * 24 * 60 * 60_000) {
    return NextResponse.json({ error: "at must be from now up to 60 days ahead" }, { status: 400 });
  }

  const business = await prisma.business.findUniqueOrThrow({ where: { id: auth.business.id }, include: { locations: true } });
  const phone = normalizePhone(p.phone, business.country);
  if (!phone) return NextResponse.json({ error: "phone is not a valid number" }, { status: 400 });
  const location = business.locations.find((l) => l.id === p.locationId) ?? business.locations.find((l) => l.status === "ACTIVE") ?? business.locations[0];
  if (!location) return NextResponse.json({ error: "No location" }, { status: 404 });

  const source = p.callId ? `call:${p.callId}` : null;
  if (source) {
    const existing = await prisma.reservation.findUnique({ where: { source } });
    if (existing) return NextResponse.json({ status: "DUPLICATE", reservationId: existing.id });
  }
  const customer = await upsertCustomer(business, location, phone, p.name);
  const reservation = await prisma.reservation.create({
    data: { businessId: business.id, locationId: location.id, customerId: customer.id, kind: p.kind, partySize: p.partySize ?? null, at, items: p.items ?? null, notes: p.notes ?? null, source },
  });

  const s = await getSettings(business);
  const line = reservationLine({ ...p, at }, s.timezone);
  const first = (customer.name ?? p.name ?? "").trim().split(/\s+/)[0] || "ji";
  // A booking confirmation is a service message, so it goes even without marketing consent.
  const sent = await sendCustomerWhatsApp({ business, location, customer, purpose: "BOOKING_LINK", templateKey: "reservation_confirm", params: [first, senderName(location, business), line], now }).catch(() => null);
  if (sent?.ok) await prisma.reservation.update({ where: { id: reservation.id }, data: { confirmedAt: now } });

  const owner = location.ownerNotifyPhone || ownerPhoneFor(s, business);
  if (owner && ownerWhatsAppSender(location, business)) {
    const who = customer.name ? `${customer.name} (+${customer.phone})` : `+${customer.phone}`;
    await sendOwnerWhatsApp(business, location, owner, { templateKey: "owner_new_message", params: [senderName(location, business), who, `AI booked ${line}${p.notes ? ` — ${p.notes}` : ""}`] }).catch(() => false);
  }
  await ingestGrowthEvents(business, [{ type: "BOOKING", phone, locationId: location.id, occurredAt: now.toISOString(), externalId: `res:${reservation.id}`, data: { kind: p.kind, partySize: p.partySize, at: p.at } }], "api:reservation").catch(() => null);

  return NextResponse.json({ status: "BOOKED", reservationId: reservation.id, confirmation: sent?.ok ? "SENT" : "NOT_SENT", summary: line });
}
