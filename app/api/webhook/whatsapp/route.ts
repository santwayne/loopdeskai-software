import { businessTools } from "@/lib/hub/catalog-rules";
import { NextRequest, NextResponse } from "next/server";
import type { Business, Location } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { classifyMessageType, isOptOutMessage, isQualifyingVisit, verifyWebhookSignature, WhatsAppWebhookPayload } from "@/lib/whatsapp";
import { runSegmentationForBusiness } from "@/lib/run-segmentation";
import { logEvent } from "@/lib/logger";
import { handleOwnerReply } from "@/lib/growth/brief";
import { sendOwnerSms, senderName } from "@/lib/sms";
import { ownerWhatsAppSender, sendCustomerWhatsApp, sendOwnerWhatsApp } from "@/lib/whatsapp-send";
import { sharedCountries, sharedDisplayNumber, waErrorText } from "@/lib/whatsapp-sender";
import { onMessageDeliveryFailed } from "@/lib/growth/delivery";
import { smsConfigured } from "@/lib/sms";
import { handleStaffMessage, OWNER_NOT_INBOX } from "@/lib/staff";
import { applyConsentReply, applyJoin, consentAnswerText, parseConsentReply, parseJoin, welcomeText } from "@/lib/onboarding";
import { REGULARS_TOOL, forwardInbound, forwardStatuses, inboundTool, latestSharedToolContact, regularsTakesInbound, toolRouteForOwner } from "@/lib/hub/tool-whatsapp";
import { handleRatingReply } from "@/lib/feedback";
import { handleBirthdayReply } from "@/lib/birthday";
import { pushOptOutToRegulars } from "@/lib/hub/regulars-opt-out";
import { parseReferral, referralLink } from "@/lib/loyalty";
import { applyReferralOnJoin, ensureReferralCode } from "@/lib/loyalty-db";
import { regularsBusinessForJoinCode } from "@/lib/hub/regulars-sync";

/** Owner scanned a QR whose code no location has (an old print, or another app's QR). */
const STRAY_JOIN_TEXT = (code: string) =>
  `Ye QR code (JOIN ${code}) kisi business se match nahi hua, isliye customer add nahi hua. Dashboard → QR codes se naya QR download karke print karein.`;

// GET — Meta's webhook verification handshake. Each Location gets its own
// whatsappVerifyToken (shown on the Settings page); we also accept the
// global WHATSAPP_WEBHOOK_VERIFY_TOKEN, which is the one to use for the
// shared Loopdesk number and for a first-time setup.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  if (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  const location = await prisma.location.findFirst({ where: { whatsappVerifyToken: token } });
  if (location) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

type LocWithBusiness = Location & { business: Business };

const STATUS: Record<string, string> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };
/**
 * Meta can deliver receipts out of order (a late "sent" after "delivered").
 * A status only moves forward; FAILED is final.
 */
const RANK: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3, FAILED: 9 };
const lowerThan = (status: string) => Object.keys(RANK).filter((k) => RANK[k] < RANK[status] && k !== "FAILED");

/** Meta's "Test" button on the webhook settings page sends this made-up number id. */
const META_SAMPLE_PHONE_NUMBER_IDS = ["123456123"];

/**
 * Inbound on the shared number (+91 90414 36801): many businesses send from
 * it, so work out which one this person is talking to.
 *  0. a QR scan: "JOIN <code>" names the location itself
 *  1. the owner of a business on the shared number (brief replies, approvals)
 *     or one of its managers ("add Rahul 98…")
 *  2. the business that last messaged this person from the shared number —
 *     Regulars itself, or a tool sending through the hub (Loyvexa dealers)
 *  3. the shared-number business this phone is already a customer of
 */
async function routeShared(from: string, text?: string): Promise<{ location: LocWithBusiness; owner: boolean; regularsJoin?: boolean } | null> {
  const countries = sharedCountries();
  const phones = [from, `+${from}`];
  const onShared = { whatsappPhoneNumberId: null } as const;

  const join = parseJoin(text);
  if (join) {
    const joined = await prisma.location.findFirst({ where: { ...onShared, joinCode: join.code }, include: { business: true } });
    if (joined) return { location: joined, owner: false };
    // Not our code: a Regulars QR? (bug list 28 Nov 2026, A3: Regulars' "JOIN
    // 9H75JS" fell through to the owner's Loyvexa contact and Loyvexa answered.)
    const hubBiz = await regularsBusinessForJoinCode(join.code);
    const loc = hubBiz ? await prisma.location.findFirst({ where: { businessId: hubBiz, ...onShared }, orderBy: { createdAt: "asc" }, include: { business: true } }) : null;
    if (loc) return { location: loc, owner: false, regularsJoin: true };
  }

  // Owners in any country can get their brief from the shared number
  // (lib/whatsapp-send.ts ownerWhatsAppSender), so their replies route here too.
  const settings = await prisma.growthSettings.findFirst({
    where: { ownerPhone: { in: phones }, enabled: true },
    include: { business: { include: { locations: { where: onShared, orderBy: { createdAt: "asc" }, take: 1 } } } },
  });
  const ownerLoc = settings?.business.locations[0]
    ?? (await prisma.location.findFirst({ where: { ...onShared, ownerNotifyPhone: { in: phones } } }));
  if (ownerLoc) {
    const location = await prisma.location.findUnique({ where: { id: ownerLoc.id }, include: { business: true } });
    if (location) return { location, owner: true };
  }
  // A manager (Dashboard → Team saves their mobile as digits).
  const manager = await prisma.user.findFirst({
    where: { role: "MANAGER", phone: { in: phones }, managedBusiness: { status: "ACTIVE" } },
    select: { managedBusiness: { select: { locations: { where: onShared, orderBy: { createdAt: "asc" }, take: 1, include: { business: true } } } } },
  });
  const managerLoc = manager?.managedBusiness?.locations[0];
  if (managerLoc) return { location: managerLoc, owner: true };

  const lastOut = await prisma.message.findFirst({
    where: { channel: "WHATSAPP", direction: "OUTBOUND", customer: { phone: from }, location: onShared },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, location: { include: { business: true } } },
  });
  const toolContact = await latestSharedToolContact(from);
  if (toolContact?.lastOutboundAt && (!lastOut || toolContact.lastOutboundAt >= lastOut.createdAt)) {
    const loc = await prisma.location.findFirst({ where: { businessId: toolContact.businessId, ...onShared }, orderBy: { createdAt: "asc" }, include: { business: true } });
    if (loc) return { location: loc, owner: false };
  }
  if (lastOut) return { location: lastOut.location, owner: false };

  const known = await prisma.customer.findFirst({
    where: { phone: from, location: onShared, business: { country: { in: countries } } },
    orderBy: { lastSeenAt: "desc" },
    select: { location: { include: { business: true } } },
  });
  return known ? { location: known.location, owner: false } : null;
}

// POST — inbound WhatsApp events:
//  - delivery receipts (sent / delivered / read / failed) update our messages
//  - a business owner's reply to the morning brief ("1 3", "ALL", "SKIP")
//  - customer messages: passive data capture + the two-way inbox
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!(await verifyWebhookSignature(rawBody, signature))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await logEvent({ source: "WEBHOOK", level: "ERROR", message: "Received invalid JSON body" });
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const affectedBusinessIds = new Set<string>();
  const sharedId = process.env.WHATSAPP_SHARED_PHONE_NUMBER_ID;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const { value } = change;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // Delivery receipts for messages we sent.
      for (const st of value.statuses ?? []) {
        const status = STATUS[st.status];
        if (!status) continue;
        await prisma.message.updateMany({
          where: { providerSid: st.id, channel: "WHATSAPP", direction: "OUTBOUND", status: { in: [...lowerThan(status), "QUEUED", "SENDING"] } },
          data: { status },
        });
        if (status === "FAILED") {
          // Keep Meta's reason on the message so the inbox can show it (e.g. 131049).
          const err = st.errors?.[0];
          const msg = await prisma.message.findFirst({ where: { providerSid: st.id, channel: "WHATSAPP", direction: "OUTBOUND" }, select: { id: true, businessId: true, rawPayload: true } });
          if (msg) {
            let raw: Record<string, unknown> = {};
            try { raw = msg.rawPayload ? JSON.parse(msg.rawPayload) : {}; } catch { /* keep empty */ }
            await prisma.message.update({ where: { id: msg.id }, data: { rawPayload: JSON.stringify({ ...raw, deliveryError: { code: err?.code ?? null, title: err?.title ?? null } }) } });
            // The Growth AI page must show "Failed", not "Done" (bug B1); 131049 is retried once tomorrow (bug B4).
            await onMessageDeliveryFailed({ messageId: msg.id, code: err?.code ?? null, reason: waErrorText(err?.code, err?.title) });
          }
          await logEvent({ businessId: msg?.businessId, source: "WHATSAPP", level: "WARN", message: `WhatsApp message failed to deliver${err?.code ? ` (Meta ${err.code})` : ""}`, meta: { id: st.id, errors: st.errors } });
        }
      }
      // Receipts for messages a tool (Loyvexa) sent through the hub go back to it.
      if (value.statuses?.length) await forwardStatuses(value.statuses).catch(() => {});
      if (!value.messages?.length) continue;

      const ownLocation = await prisma.location.findUnique({
        where: { whatsappPhoneNumberId: phoneNumberId },
        include: { business: true },
      });
      const isShared = !ownLocation && !!sharedId && phoneNumberId === sharedId;
      if (!ownLocation && !isShared) {
        // Location hasn't finished setup yet — ack with 200 so Meta doesn't retry.
        if (META_SAMPLE_PHONE_NUMBER_IDS.includes(phoneNumberId)) {
          // Not a misconfiguration (bug B13): someone pressed "Test" in the Meta App Dashboard.
          await logEvent({ source: "WEBHOOK", level: "INFO", message: "Meta dashboard test event received (sample phone_number_id 123456123) — webhook is reachable" });
        } else {
          await logEvent({ source: "WEBHOOK", level: "WARN", message: `Webhook event for unrecognized phone_number_id ${phoneNumberId}`, meta: { hint: "Not the shared number (WHATSAPP_SHARED_PHONE_NUMBER_ID) and no location has this id in Settings." } });
        }
        continue;
      }

      const contactsByWaId = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));

      for (const message of value.messages) {
        const text = message.text?.body ?? message.button?.text ?? message.interactive?.button_reply?.title;
        let location: LocWithBusiness | null = ownLocation;
        let fromOwner = false;
        let regularsJoin = false;
        if (isShared) {
          const routed = await routeShared(message.from, text);
          location = routed?.location ?? null;
          fromOwner = !!routed?.owner;
          regularsJoin = !!routed?.regularsJoin;
          if (!location) {
            await logEvent({ source: "WHATSAPP", level: "WARN", message: "Message on the shared number from someone no business has contacted (they must scan a business's QR first, so we know which business they mean)", meta: { from: message.from, text: text?.slice(0, 80) ?? null } });
            continue;
          }
        }
        if (!location) continue;
        const business = location.business;
        if (business.status === "SUSPENDED" || location.status === "SUSPENDED") continue;

        try {
          // A QR scan ("JOIN <code>" for this location) is always a customer
          // joining Regulars, even from a phone a tool (Loyvexa) wrote to last,
          // or from the owner's / a manager's own phone while testing.
          // (Testing bugs 1 + 2, 27 Nov 2026: the JOIN went to Loyvexa, which
          // answered with its points link, and no customer was created.)
          const qrJoin = parseJoin(text);
          const joining = !!qrJoin && location.joinCode === qrJoin.code;
          // A Regulars QR for this business (its code can differ from ours) — A3, 28 Nov 2026.
          if (qrJoin && !joining && !regularsJoin && regularsTakesInbound(business)) {
            regularsJoin = (await regularsBusinessForJoinCode(qrJoin.code)) === business.id;
          }
          const anyJoin = joining || regularsJoin;
          // "JOIN <code>" that is nobody's QR: never a tool's message (Loyvexa
          // must not answer it with "aap registered nahi ho").
          const strayJoin = !!qrJoin && !anyJoin;
          if (regularsJoin && !regularsTakesInbound(business)) {
            await logEvent({ businessId: business.id, source: "WHATSAPP", level: "WARN", message: "Regulars QR scanned, but Regulars is not live in this business's bundle", meta: { code: qrJoin?.code ?? null } });
            continue;
          }

          // The owner approving an offer / a manager adding a customer.
          if (text && !anyJoin && (await handleStaffMessage(location, message.from, text, "WHATSAPP").catch(async (err) => {
            await logEvent({ businessId: business.id, source: "WHATSAPP", level: "ERROR", message: "Staff command failed", meta: { error: err instanceof Error ? err.message : String(err) } });
            return false;
          }))) continue;
          // The owner answering the daily brief.
          if (text && !anyJoin && (await handleOwnerReply(location, message.from, text).catch(() => false))) continue;
          if (fromOwner && strayJoin) {
            // The owner testing an old / wrong QR: say so instead of passing it to a tool.
            await sendOwnerWhatsApp(business, location, message.from, { text: STRAY_JOIN_TEXT(qrJoin!.code) }).catch(() => false);
            await logEvent({ businessId: business.id, source: "WHATSAPP", level: "WARN", message: "QR join code not found (no location here or in Regulars has it)", meta: { from: message.from, code: qrJoin!.code } });
            continue;
          }
          if (fromOwner && !anyJoin) {
            // Bug report 27 Nov 2026 #2: anything that isn't a plan reply / staff
            // command (STOP, START, "hi", "points"…) goes to a tool that has written
            // to this phone — the owner's number can also be a Loyvexa dealer.
            const route = await toolRouteForOwner(business.id, message.from, businessTools(business)).catch(() => null);
            if (route) {
              await forwardInbound(route.tool, route.businessId, { from: message.from, text: text ?? null, id: message.id }, message as unknown as Record<string, unknown>, null);
              await logEvent({ businessId: route.businessId, source: "WHATSAPP", level: "INFO", message: `Owner's phone wrote to the shared number — passed on to ${route.tool}`, meta: { from: message.from, text: text?.slice(0, 40) ?? null } });
              continue;
            }
            // The owner chatting to the shared number is not a customer, so it
            // never shows in the inbox. Say so, instead of going quiet (testing bug 3).
            await sendOwnerWhatsApp(business, location, message.from, { text: OWNER_NOT_INBOX }).catch(() => false);
            await logEvent({ businessId: business.id, source: "WHATSAPP", level: "INFO", message: "Owner wrote to the shared number (not a customer message, not shown in the inbox)", meta: { from: message.from } });
            continue;
          }

          // A tool's person (Loyvexa dealer / mechanic: "points", "order", "2"…) —
          // the tool's bot answers through the hub; not a Regulars customer.
          const tool = anyJoin || strayJoin ? null : await inboundTool(business.id, message.from, businessTools(business));
          if (tool) {
            await forwardInbound(tool, business.id, { from: message.from, text: text ?? null, id: message.id, profileName: contactsByWaId.get(message.from) ?? null }, message as unknown as Record<string, unknown>, isShared ? null : location.id);
            continue;
          }
          // Bundle with Regulars (separate app, own database): its customers —
          // QR joins, YES/NO answers, inbox messages — belong to Regulars, which
          // answers through the hub from this same number (Regulars retest, 27 Nov 2026).
          if (regularsTakesInbound(business)) {
            // hubJoin: we matched this QR to the business, so Regulars treats it as a join even if its own code differs.
            const raw = { ...(message as unknown as Record<string, unknown>), ...(anyJoin ? { hubJoin: true } : {}) };
            await forwardInbound(REGULARS_TOOL, business.id, { from: message.from, text: text ?? null, id: message.id, profileName: contactsByWaId.get(message.from) ?? null }, raw, isShared ? null : location.id);
            continue;
          }

          const messageType = classifyMessageType(text);
          const optOut = isOptOutMessage(text);
          const now = new Date();

          const wasOptedOut = !!(await prisma.customer.findUnique({ where: { locationId_phone: { locationId: location.id, phone: message.from } }, select: { optedOut: true } }))?.optedOut;
          const customer = await prisma.customer.upsert({
            where: { locationId_phone: { locationId: location.id, phone: message.from } },
            create: {
              businessId: business.id,
              locationId: location.id,
              phone: message.from,
              name: contactsByWaId.get(message.from) ?? null,
              firstSeenAt: now,
              lastSeenAt: now,
              visitCount: isQualifyingVisit(messageType) ? 1 : 0,
              preferredChannel: "WHATSAPP", // they reached us on WhatsApp
              consentSource: "INBOUND", // they wrote first (consentStatus IMPLIED)
              optedOut: optOut,
              optedOutAt: optOut ? now : null,
            },
            update: {
              // Never overwrite the name the business saved with the
              // WhatsApp profile name ("AK" became "arpansaini", bug B18).
              // The profile name only fills an empty name, below.
              lastSeenAt: now,
              ...(isQualifyingVisit(messageType) ? { visitCount: { increment: 1 } } : {}),
              // Opt-outs are one-directional here: once set, only the
              // business owner can undo it via Settings, not a later
              // inbound message.
              ...(optOut ? { optedOut: true, optedOutAt: now } : {}),
            },
          });

          // A new STOP: Regulars must stop too (Regulars bug list #1, 27 Nov 2026).
          if (optOut && !wasOptedOut) await pushOptOutToRegulars(business.id, [customer.phone], true);

          const profileName = contactsByWaId.get(message.from)?.trim();
          if (!customer.name && profileName) {
            await prisma.customer.update({ where: { id: customer.id }, data: { name: profileName } });
            customer.name = profileName;
          }

          const stored = await prisma.message.create({
            data: {
              businessId: business.id,
              locationId: location.id,
              customerId: customer.id,
              direction: "INBOUND",
              channel: "WHATSAPP",
              purpose: "REPLY",
              status: "RECEIVED",
              providerSid: message.id,
              type: messageType,
              text: text ?? (message.type !== "text" ? `[${message.type}]` : null),
              readAt: optOut ? now : null,
              rawPayload: JSON.stringify(message),
            },
          }).catch((err) => {
            if (String(err?.code) === "P2002") return null; // Meta retried this event — already stored
            throw err;
          });
          if (!stored) continue;

          // QR scan ("JOIN <code>") or an answer to the YES/NO consent request:
          // handled automatically — a thank-you goes back, the owner isn't pinged.
          let automatic = false;
          const decision = !optOut && customer.consentStatus === "PENDING" ? parseConsentReply(text) : null;
          if (joining && qrJoin) {
            const joined = await applyJoin(customer, qrJoin.tag, now);
            // Scanning the QR again after STOP = they want messages again, in Regulars too.
            if (customer.optedOut && !joined.optedOut) await pushOptOutToRegulars(business.id, [customer.phone], false);
            // Loyalty: "JOIN … REF ABC234" links the friend who shared it; everyone gets their own link.
            let shareLink: string | null = null;
            if (business.loyaltyEnabled) {
              const ref = parseReferral(text);
              if (ref) await applyReferralOnJoin(joined, ref).catch(() => false);
              const code = await ensureReferralCode(joined).catch(() => null);
              if (code && location.joinCode) shareLink = referralLink(location.whatsappDisplayNumber ?? sharedDisplayNumber(), location.joinCode, code);
            }
            await sendCustomerWhatsApp({ business, location, customer: joined, purpose: "OTHER", text: await welcomeText(business, senderName(location, business), shareLink), now });
            automatic = true;
          } else if (decision) {
            const answered = await applyConsentReply(customer, decision, now);
            await sendCustomerWhatsApp({ business, location, customer: answered, purpose: "OTHER", text: await consentAnswerText(business, senderName(location, business), decision), now });
            automatic = true;
          } else if (!optOut && (await handleRatingReply(business, location, customer, text, now))) {
            // A 1–5 answer to the feedback request (Restaurant Bundle). Low
            // ratings alert the owner inside handleRatingReply.
            automatic = true;
          } else if (!optOut && (await handleBirthdayReply(business, location, customer, text, now))) {
            automatic = true; // "BDAY 12/05"
          }
          if (automatic) await prisma.message.update({ where: { id: stored.id }, data: { readAt: now } });

          if (isQualifyingVisit(messageType)) {
            await prisma.visit.create({
              data: {
                businessId: business.id,
                locationId: location.id,
                customerId: customer.id,
                occurredAt: now,
                source: `whatsapp:${messageType.toLowerCase()}`,
              },
            });
          }

          // Tell the owner (opt-in: Settings → "Forward customer replies to").
          if (!optOut && !automatic && location.ownerNotifyPhone) {
            const who = customer.name ? `${customer.name} (+${customer.phone})` : `+${customer.phone}`;
            const name = senderName(location, business);
            // WhatsApp whenever we can reach the owner there (the shared number works for
            // owners in any country), SMS only when that's what's set up.
            const smsReady = !!location.smsFromNumber && smsConfigured();
            if (ownerWhatsAppSender(location, business) && !(business.defaultChannel === "SMS" && smsReady)) {
              await sendOwnerWhatsApp(business, location, location.ownerNotifyPhone, {
                templateKey: "owner_new_message", params: [name, who, text ?? `[${message.type}]`],
              });
            } else {
              await sendOwnerSms(business, location, `${name} inbox — ${who}: ${text ?? `[${message.type}]`}`);
            }
          }

          affectedBusinessIds.add(business.id);
        } catch (err) {
          await logEvent({
            businessId: business.id,
            source: "WEBHOOK",
            level: "ERROR",
            message: "Failed processing an inbound WhatsApp message",
            meta: { locationId: location.id, error: err instanceof Error ? err.message : String(err) },
          });
        }
      }
    }
  }

  for (const businessId of affectedBusinessIds) {
    await runSegmentationForBusiness(businessId);
  }

  return NextResponse.json({ received: true });
}
