import type { Business, Customer, Location } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logger";
import { senderName } from "@/lib/sms";
import { businessLanguage, sendCustomerWhatsApp, sendOwnerWhatsApp, ownerWhatsAppSender } from "@/lib/whatsapp-send";
import { whatsappSenderFor } from "@/lib/whatsapp-sender";
import { getSettings, withinContactHours } from "@/lib/growth/settings";
import { HAS_REAL_PHONE } from "@/lib/instagram-shared";
import {
  FEEDBACK_MAX_DELAY_MS, FEEDBACK_MIN_DELAY_MS, FEEDBACK_REPLY_WINDOW_MS,
  feedbackDue, parseRating, ratingReplyText, ratingRoute,
} from "@/lib/restaurant";

/**
 * Restaurant Bundle feedback loop (Nov 2026).
 *
 *  1. Hourly cron: bills (Visits) 1–3 hours old at businesses with
 *     autoFeedback on get the "feedback_request" template (1–5).
 *  2. Webhook: a 1–5 reply within 48 h of the request is saved on the visit.
 *     4–5 → thank-you with the Google (and Zomato) review link.
 *     1–3 → apology to the customer, and an alert to the owner on WhatsApp.
 *     A low rating is never sent to a public review page.
 *
 * Visit.feedbackRequestedAt: the time we asked; NOT_ASKED (1 Jan 1970) for a
 * bill we decided not to ask about (customer asked this week, no WhatsApp
 * sender, send failed), so it isn't picked up again and a reply never
 * attaches to it.
 */
const NOT_ASKED = new Date(0);

/** Hourly: send rating requests that are due. */
export async function requestDueFeedback(now = new Date(), perBusiness = 200) {
  const businesses = await prisma.business.findMany({ where: { status: "ACTIVE", autoFeedback: true } });
  let sent = 0, skipped = 0;
  for (const business of businesses) {
    if (!withinContactHours(await getSettings(business), now)) continue;
    const visits = await prisma.visit.findMany({
      where: {
        businessId: business.id,
        feedbackRequestedAt: null,
        occurredAt: { gte: new Date(now.getTime() - FEEDBACK_MAX_DELAY_MS), lte: new Date(now.getTime() - FEEDBACK_MIN_DELAY_MS) },
        customer: { optedOut: false, ...HAS_REAL_PHONE },
      },
      include: { customer: true, location: true },
      orderBy: { occurredAt: "asc" },
      take: perBusiness,
    });
    const askedNow = new Set<string>();
    for (const v of visits) {
      const ask = !askedNow.has(v.customerId) && feedbackDue(v, v.customer.lastFeedbackRequestAt, now)
        && v.location.status !== "SUSPENDED" && !!whatsappSenderFor(v.location, business);
      // Mark first, so a slow send or a second cron run never asks twice.
      const claimed = await prisma.visit.updateMany({ where: { id: v.id, feedbackRequestedAt: null }, data: { feedbackRequestedAt: ask ? now : NOT_ASKED } });
      if (!claimed.count) continue;
      if (!ask) { skipped++; continue; }
      const r = await sendCustomerWhatsApp({
        business, location: v.location, customer: v.customer, purpose: "OTHER",
        templateKey: "feedback_request", params: [firstName(v.customer, "en"), senderName(v.location, business)], now,
      });
      if (r?.ok) {
        sent++;
        askedNow.add(v.customerId);
        await prisma.customer.update({ where: { id: v.customerId }, data: { lastFeedbackRequestAt: now } });
      } else {
        skipped++;
        await prisma.visit.update({ where: { id: v.id }, data: { feedbackRequestedAt: NOT_ASKED } });
      }
    }
  }
  return { businesses: businesses.length, sent, skipped };
}

/**
 * Webhook: if this inbound text is a rating for a visit we asked about,
 * handle it and return true (the normal "new message" ping is skipped,
 * the owner gets the rating alert instead).
 */
export async function handleRatingReply(
  business: Business, location: Location, customer: Customer, text: string | null | undefined, now = new Date(),
): Promise<boolean> {
  const rating = parseRating(text);
  if (rating == null) return false;
  const visit = await prisma.visit.findFirst({
    where: { customerId: customer.id, rating: null, feedbackRequestedAt: { gte: new Date(now.getTime() - FEEDBACK_REPLY_WINDOW_MS) } },
    orderBy: { feedbackRequestedAt: "desc" },
  });
  if (!visit) return false;
  await prisma.visit.update({ where: { id: visit.id }, data: { rating, ratedAt: now } });

  const lang = (await businessLanguage(business)) === "en" ? "en" : "hinglish";
  const reply = ratingReplyText(rating, { google: location.googleReviewUrl, zomato: location.zomatoUrl }, lang);
  // They just wrote to us, so the 24-hour window is open: plain text is fine.
  await sendCustomerWhatsApp({ business, location, customer, purpose: "OTHER", text: reply, now }).catch(() => null);

  if (ratingRoute(rating) === "PRIVATE_ALERT") {
    const who = customer.name ? `${customer.name} (+${customer.phone})` : `+${customer.phone}`;
    const bill = visit.amount != null ? `, bill ${visit.amount}` : "";
    const alert = `${rating}/5 rating${bill}. Please call them today — it was not posted anywhere.`;
    // The location's forward number, else the owner's number from Growth settings.
    const to = location.ownerNotifyPhone || (await getSettings(business)).ownerPhone || null;
    if (to && ownerWhatsAppSender(location, business)) {
      await sendOwnerWhatsApp(business, location, to, { templateKey: "owner_new_message", params: [senderName(location, business), who, alert] }).catch(() => null);
    }
    await logEvent({ businessId: business.id, source: "WHATSAPP", level: "WARN", message: `Low rating ${rating}/5 from ${who}`, meta: { visitId: visit.id, ownerAlerted: !!to } });
  }
  return true;
}

function firstName(c: Pick<Customer, "name">, lang: "en" | "hinglish") {
  return (c.name ?? "").trim().split(/\s+/)[0] || (lang === "en" ? "there" : "ji");
}
