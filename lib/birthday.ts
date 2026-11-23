import type { Business, Customer, Location } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { senderName } from "@/lib/sms";
import { mayMarket } from "@/lib/consent";
import { businessLanguage, sendCustomerWhatsApp } from "@/lib/whatsapp-send";
import { whatsappSenderFor } from "@/lib/whatsapp-sender";
import { getSettings, withinContactHours } from "@/lib/growth/settings";
import { HAS_REAL_PHONE } from "@/lib/instagram-shared";
import { birthdayOfferDue, birthdaySavedText, localDate, parseBirthday } from "@/lib/restaurant";

/**
 * Birthday offers (Restaurant Bundle, Nov 2026).
 *  - Customers send "BDAY 12/05" (the welcome message asks restaurants'
 *    customers for it); staff can also save it on the customer.
 *  - Hourly cron, in contact hours: 7 days before the birthday, customers
 *    who may get marketing get the "birthday_offer" template, once a year.
 */

export const DEFAULT_BIRTHDAY_TREAT = "a free dessert with any order on your birthday week";

/** Webhook: "BDAY 12/05" → saved, short thank-you. Returns true when handled. */
export async function handleBirthdayReply(business: Business, location: Location, customer: Customer, text: string | null | undefined, now = new Date()) {
  // Only businesses that send birthday offers ask for it (and promise a treat).
  if (!business.autoBirthday) return false;
  const birthday = parseBirthday(text);
  if (!birthday) return false;
  const updated = await prisma.customer.update({ where: { id: customer.id }, data: { birthday } });
  const lang = (await businessLanguage(business)) === "en" ? "en" : "hinglish";
  await sendCustomerWhatsApp({ business, location, customer: updated, purpose: "OTHER", text: birthdaySavedText(lang), now }).catch(() => null);
  return true;
}

/** Hourly: send this year's birthday offers that are due today (business local date). */
export async function sendBirthdayOffers(now = new Date(), perBusiness = 300) {
  const businesses = await prisma.business.findMany({ where: { status: "ACTIVE", autoBirthday: true } });
  let sent = 0, skipped = 0;
  for (const business of businesses) {
    const settings = await getSettings(business);
    if (!withinContactHours(settings, now)) continue;
    const today = localDate(now, settings.timezone);
    const customers = await prisma.customer.findMany({
      where: { businessId: business.id, birthday: { not: null }, optedOut: false, ...HAS_REAL_PHONE },
      include: { location: true },
      take: 5000,
    });
    let done = 0;
    for (const c of customers) {
      if (done >= perBusiness) break;
      if (!birthdayOfferDue(c.birthday, c.lastBirthdayOfferYear, today)) continue;
      if (!mayMarket(c, business.country, now) || !whatsappSenderFor(c.location, business)) { skipped++; continue; }
      // The year of the birthday itself (a 2 Jan birthday is offered on 26 Dec).
      const target = new Date(Date.UTC(today.year, today.month - 1, today.day + 7)).getUTCFullYear();
      const claimed = await prisma.customer.updateMany({
        where: { id: c.id, OR: [{ lastBirthdayOfferYear: null }, { NOT: { lastBirthdayOfferYear: target } }] },
        data: { lastBirthdayOfferYear: target },
      });
      if (!claimed.count) continue;
      done++;
      const first = (c.name ?? "").trim().split(/\s+/)[0] || "ji";
      const r = await sendCustomerWhatsApp({
        business, location: c.location, customer: c, purpose: "OFFER", templateKey: "birthday_offer",
        params: [first, senderName(c.location, business), business.birthdayOfferText?.trim() || DEFAULT_BIRTHDAY_TREAT], now,
      });
      if (r?.ok) sent++;
      else {
        skipped++;
        // Not sent (e.g. Meta's daily marketing limit): let the next hourly run try again today.
        await prisma.customer.update({ where: { id: c.id }, data: { lastBirthdayOfferYear: c.lastBirthdayOfferYear } });
      }
    }
  }
  return { businesses: businesses.length, sent, skipped };
}
