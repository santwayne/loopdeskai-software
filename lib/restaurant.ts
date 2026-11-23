/**
 * Restaurant Bundle, phase 1 (Nov 2026): the rules, with no database access
 * (unit-tested in test/restaurant.test.ts).
 *
 *  - words the owner sees for a RESTAURANT business (orders/bills, not visits)
 *  - ready offer templates (weekday combo, birthday dessert, happy hours, 5th order free)
 *  - feedback loop: 1–5 rating 1–2 hours after the bill; 4–5 → Google/Zomato
 *    review link, 1–3 → private alert to the owner (nothing public)
 *  - birthdays: "BDAY 12/05" saved as "05-12"; an offer goes 7 days before
 *
 * lib/feedback.ts and lib/birthday.ts do the reads and sends.
 */

// ── Words ────────────────────────────────────────────────────────────────
export type SectorTerms = {
  visit: string; visits: string; totalSpend: string; avgValue: string;
  booking: string; service: string; winbackExample: string;
};

const GENERAL: SectorTerms = {
  visit: "Visit", visits: "Visits", totalSpend: "Total spend", avgValue: "Avg job value",
  booking: "Booking", service: "Service", winbackExample: "We miss you! 15% off your next visit.",
};

const RESTAURANT: SectorTerms = {
  visit: "Order", visits: "Orders", totalSpend: "Total bills", avgValue: "Avg bill value",
  booking: "Table reservation", service: "Dish / combo", winbackExample: "Aapki favourite dish pe 20% off — is hafte aaiye!",
};

export function isRestaurant(sector: string | null | undefined) {
  return (sector ?? "").toUpperCase() === "RESTAURANT";
}

export function termsForSector(sector: string | null | undefined): SectorTerms {
  return isRestaurant(sector) ? RESTAURANT : GENERAL;
}

// ── Offer templates ─────────────────────────────────────────────────────
export type OfferTemplate = { id: string; title: string; message: string; discountPercent: number | null; freebie: boolean; segments: string[] };

export const RESTAURANT_OFFER_TEMPLATES: OfferTemplate[] = [
  { id: "weekday-combo", title: "Weekday combo", message: "Mon–Thu special: any 2 main dishes + 2 drinks at a combo price. Show this message at the counter.", discountPercent: 15, freebie: false, segments: [] },
  { id: "birthday-dessert", title: "Birthday dessert free", message: "It's your birthday month! Get a free dessert with any order this month. Show this message at the counter.", discountPercent: null, freebie: true, segments: [] },
  { id: "happy-hours", title: "Happy hours", message: "Happy hours 3–6 pm today: 20% off on all drinks and snacks. Show this message at the counter.", discountPercent: 20, freebie: false, segments: ["REGULAR", "HIGH_SPENDER"] },
  { id: "fifth-order-free", title: "5th order free", message: "Thank you for being a regular! Your 5th order this month is on us (up to ₹300). Show this message at the counter.", discountPercent: null, freebie: true, segments: ["REGULAR"] },
  { id: "favourite-dish", title: "We miss you", message: "We miss you! 20% off your favourite dish this week. Show this message at the counter.", discountPercent: 20, freebie: false, segments: ["AT_RISK", "DORMANT"] },
];

export function offerTemplatesFor(sector: string | null | undefined): OfferTemplate[] {
  return isRestaurant(sector) ? RESTAURANT_OFFER_TEMPLATES : [];
}

// ── Feedback loop ───────────────────────────────────────────────────────
/** Ask for a rating 1–2 hours after the bill (never older bills, so a back-fill doesn't spam). */
export const FEEDBACK_MIN_DELAY_MS = 60 * 60 * 1000;
export const FEEDBACK_MAX_DELAY_MS = 3 * 60 * 60 * 1000;
/** A rating reply counts for this long after we asked. */
export const FEEDBACK_REPLY_WINDOW_MS = 48 * 60 * 60 * 1000;
/** At most one rating request per customer in this time (regulars come often). */
export const FEEDBACK_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * "5", "4 star", "3/5", "⭐⭐⭐⭐", "5 ⭐" → the rating; anything else → null.
 * Only a short reply counts, so "table for 4 at 8" is not a rating.
 */
export function parseRating(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.trim();
  if (!t || t.length > 20) return null;
  const stars = (t.match(/⭐|★/g) ?? []).length;
  const rest = t.replace(/⭐|★/g, "").trim();
  if (stars >= 1 && stars <= 5 && rest === "") return stars;
  const m = rest.match(/^([1-5])\s*(?:\/\s*5|stars?|⭐|★)?\s*[.!]?$/i);
  return m ? Number(m[1]) : null;
}

export type RatingRoute = "PUBLIC_REVIEW" | "PRIVATE_ALERT";
export function ratingRoute(rating: number): RatingRoute {
  return rating >= 4 ? "PUBLIC_REVIEW" : "PRIVATE_ALERT";
}

/** Due for a rating request: the bill is 1–3 hours old and the customer wasn't asked this week. */
export function feedbackDue(v: { occurredAt: Date; feedbackRequestedAt: Date | null }, lastAskedAt: Date | null, now: Date) {
  if (v.feedbackRequestedAt) return false;
  const age = now.getTime() - v.occurredAt.getTime();
  if (age < FEEDBACK_MIN_DELAY_MS || age > FEEDBACK_MAX_DELAY_MS) return false;
  return !lastAskedAt || now.getTime() - lastAskedAt.getTime() >= FEEDBACK_EVERY_MS;
}

/** What the customer gets back after rating. */
export function ratingReplyText(rating: number, links: { google?: string | null; zomato?: string | null }, lang: "en" | "hinglish") {
  if (ratingRoute(rating) === "PUBLIC_REVIEW") {
    const parts = [links.google ? `Google: ${links.google}` : null, links.zomato ? `Zomato: ${links.zomato}` : null].filter(Boolean).join("  ");
    if (!parts) return lang === "en" ? "Thank you so much for the rating! See you again soon." : "Rating ke liye bahut shukriya! Jaldi phir milte hain.";
    return lang === "en"
      ? `Thank you so much! Would you share that in a quick review? It really helps us. ${parts}`
      : `Bahut shukriya! Kya aap ek chhota sa review de denge? Isse humein bahut madad milti hai. ${parts}`;
  }
  return lang === "en"
    ? "Sorry we didn't get it right this time. The owner has been told and will get in touch with you."
    : "Maaf kijiye, is baar hum aapki ummeed pe khare nahi utre. Owner ko bata diya gaya hai, woh aapse baat karenge.";
}

// ── Birthdays ───────────────────────────────────────────────────────────
/**
 * "BDAY 12/05", "birthday 12-05", "DOB 12/05/1995" (day first, as in India)
 * → "05-12" (MM-DD). Needs the keyword, so a plain date in a chat isn't
 * taken as a birthday. Year is not kept.
 */
export function parseBirthday(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.trim().match(/^(?:bday|birthday|b'day|dob|janamdin)\s*[:\-]?\s*(\d{1,2})\s*[\/\-. ]\s*(\d{1,2})(?:\s*[\/\-. ]\s*(\d{2}|\d{4}))?\s*$/i);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]);
  if (month < 1 || month > 12 || day < 1) return null;
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > maxDay) return null;
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const BIRTHDAY_LEAD_DAYS = 7;

/**
 * The birthday ("MM-DD") falls exactly `lead` days after `today` (local date
 * parts given), and this year's offer hasn't gone yet. 29 Feb counts as
 * 28 Feb in other years.
 */
export function birthdayOfferDue(
  birthday: string | null | undefined, lastOfferYear: number | null | undefined,
  today: { year: number; month: number; day: number }, lead = BIRTHDAY_LEAD_DAYS,
): boolean {
  if (!birthday || !/^\d{2}-\d{2}$/.test(birthday)) return false;
  const target = new Date(Date.UTC(today.year, today.month - 1, today.day + lead));
  const ty = target.getUTCFullYear(), tm = target.getUTCMonth() + 1, td = target.getUTCDate();
  if (lastOfferYear === ty) return false;
  let [bm, bd] = birthday.split("-").map(Number);
  const leap = (ty % 4 === 0 && ty % 100 !== 0) || ty % 400 === 0;
  if (bm === 2 && bd === 29 && !leap) bd = 28;
  return bm === tm && bd === td;
}

/** Local calendar date in a time zone (e.g. Asia/Kolkata). */
export function localDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Added to the welcome message for restaurants. */
export function birthdayAsk(lang: "en" | "hinglish") {
  return lang === "en"
    ? " Send your birthday like BDAY 12/05 and get a treat on your birthday!"
    : " Apna birthday aise bhejein: BDAY 12/05, aur birthday pe treat paayein!";
}

export function birthdaySavedText(lang: "en" | "hinglish") {
  return lang === "en" ? "Got it! We'll send you a birthday treat." : "Note kar liya! Birthday pe aapko treat bhejenge.";
}

// ── Growth Manager restaurant mode (phase 3) ────────────────────────────
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The slowest weekday from bills per weekday over the last 4 weeks (index
 * 0 = Sunday), when it is clearly slow: at least 25% under the average of
 * the other days, with 20+ bills overall so a quiet start isn't "slow".
 */
export function slowestWeekday(billsByWeekday: number[]): number | null {
  if (billsByWeekday.length !== 7) return null;
  const total = billsByWeekday.reduce((t, n) => t + n, 0);
  if (total < 20) return null;
  let min = 0;
  for (let d = 1; d < 7; d++) if (billsByWeekday[d] < billsByWeekday[min]) min = d;
  const othersAvg = (total - billsByWeekday[min]) / 6;
  return billsByWeekday[min] <= othersAvg * 0.75 ? min : null;
}

/** The offer the Growth Manager proposes for a slow day. */
export function slowDayOffer(weekday: number, businessName: string) {
  const day = WEEKDAYS[weekday];
  return {
    title: `${day} combo`,
    message: `${day} special at ${businessName}: 15% off any combo today only. Show this message at the counter.`,
    discountPercent: 15,
    segments: ["REGULAR", "HIGH_SPENDER", "AT_RISK"],
  };
}

/** Win-back line for a restaurant customer ("Simran 40 din se nahi aayi"). */
export function restaurantWinbackTitle(name: string, days: number) {
  return `${name} hasn't ordered in ${days} days`;
}

// ── Reservations (phase 3) ──────────────────────────────────────────────
/** "a table for 4 on Sat 28 Nov at 9:00 pm" / "your takeaway order (2 taro boba) for pickup on …". */
export function reservationLine(r: { kind: "TABLE" | "TAKEAWAY"; partySize?: number | null; at: Date; items?: string | null }, timeZone: string) {
  const when = new Intl.DateTimeFormat("en-IN", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(r.at).replace(/,/g, "").replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toLowerCase()}`);
  if (r.kind === "TABLE") return `a table${r.partySize ? ` for ${r.partySize}` : ""} on ${when.replace(/ (\d{1,2}:\d{2})/, " at $1")}`;
  const items = (r.items ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return `your takeaway order${items ? ` (${items})` : ""} for pickup on ${when.replace(/ (\d{1,2}:\d{2})/, " at $1")}`;
}
