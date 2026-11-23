// Restaurant Bundle, phase 1 (Nov 2026): words, offer templates, rating loop, birthdays.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  birthdayOfferDue, feedbackDue, localDate, offerTemplatesFor, parseBirthday, parseRating,
  ratingReplyText, ratingRoute, termsForSector, FEEDBACK_EVERY_MS,
} from "../lib/restaurant";
import { WA_TEMPLATE_DEFS, getDef } from "../lib/whatsapp-templates";

test("restaurants see orders and bills, everyone else keeps visits", () => {
  assert.equal(termsForSector("RESTAURANT").visits, "Orders");
  assert.equal(termsForSector("restaurant").avgValue, "Avg bill value");
  assert.equal(termsForSector("RESTAURANT").booking, "Table reservation");
  assert.equal(termsForSector("SALON").visits, "Visits");
  assert.equal(termsForSector(null).visits, "Visits");
});

test("restaurants get the ready offer templates, others none", () => {
  const ids = offerTemplatesFor("RESTAURANT").map((t) => t.id);
  for (const id of ["weekday-combo", "birthday-dessert", "happy-hours", "fifth-order-free"]) assert.ok(ids.includes(id), id);
  for (const t of offerTemplatesFor("RESTAURANT")) assert.ok(t.message.length <= 500 && t.title.length <= 80);
  assert.deepEqual(offerTemplatesFor("CLINIC"), []);
});

test("rating replies: digits, stars and n/5 count; chat does not", () => {
  for (const [text, r] of [["5", 5], [" 4 ", 4], ["3/5", 3], ["2 star", 2], ["5 stars!", 5], ["⭐⭐⭐⭐", 4], ["★", 1], ["4⭐", 4]] as const) {
    assert.equal(parseRating(text), r, text);
  }
  for (const text of ["table for 4 at 8", "0", "6", "10", "45", "ok", "", null, "⭐⭐⭐⭐⭐⭐", "5 log aa rahe hain"]) {
    assert.equal(parseRating(text as string | null), null, String(text));
  }
});

test("4–5 stars go to the review links, 1–3 stay private with the owner", () => {
  assert.equal(ratingRoute(5), "PUBLIC_REVIEW");
  assert.equal(ratingRoute(4), "PUBLIC_REVIEW");
  for (const r of [1, 2, 3]) assert.equal(ratingRoute(r), "PRIVATE_ALERT");
  const links = { google: "https://g.page/r/x/review", zomato: "https://www.zomato.com/x" };
  const good = ratingReplyText(5, links, "hinglish");
  assert.ok(good.includes(links.google) && good.includes(links.zomato));
  const bad = ratingReplyText(2, links, "en");
  assert.ok(!bad.includes("g.page") && !bad.includes("zomato"), "a low rating never gets a public review link");
  assert.ok(!ratingReplyText(5, {}, "en").includes("http"));
});

test("the rating request goes 1–3 hours after the bill, at most weekly per customer", () => {
  const now = new Date("2026-11-23T14:00:00Z");
  const h = (n: number) => new Date(now.getTime() - n * 3600_000);
  assert.equal(feedbackDue({ occurredAt: h(1.5), feedbackRequestedAt: null }, null, now), true);
  assert.equal(feedbackDue({ occurredAt: h(0.5), feedbackRequestedAt: null }, null, now), false, "too soon");
  assert.equal(feedbackDue({ occurredAt: h(5), feedbackRequestedAt: null }, null, now), false, "too old (back-filled bills)");
  assert.equal(feedbackDue({ occurredAt: h(2), feedbackRequestedAt: h(1) }, null, now), false, "already asked");
  assert.equal(feedbackDue({ occurredAt: h(2), feedbackRequestedAt: null }, new Date(now.getTime() - FEEDBACK_EVERY_MS + 3600_000), now), false, "asked this week");
});

test("birthdays: keyword + day/month, year dropped, bad dates refused", () => {
  assert.equal(parseBirthday("BDAY 12/05"), "05-12");
  assert.equal(parseBirthday("birthday 3-8"), "08-03");
  assert.equal(parseBirthday("DOB: 29/02/1996"), "02-29");
  assert.equal(parseBirthday("bday 31.12"), "12-31");
  for (const t of ["12/05", "BDAY 31/04", "BDAY 12/13", "bday soon", "my bday is 12/05 lol", null]) assert.equal(parseBirthday(t as string | null), null, String(t));
});

test("birthday offer goes 7 days before, once a year, across the new year and on 28 Feb for 29 Feb", () => {
  assert.equal(birthdayOfferDue("12-02", null, { year: 2026, month: 11, day: 25 }), true);
  assert.equal(birthdayOfferDue("12-02", null, { year: 2026, month: 11, day: 24 }), false);
  assert.equal(birthdayOfferDue("12-02", 2026, { year: 2026, month: 11, day: 25 }), false, "already sent this year");
  assert.equal(birthdayOfferDue("12-02", 2025, { year: 2026, month: 11, day: 25 }), true);
  assert.equal(birthdayOfferDue("01-02", 2026, { year: 2026, month: 12, day: 26 }), true, "2 Jan 2027 birthday, last sent 2026");
  assert.equal(birthdayOfferDue("01-02", 2027, { year: 2026, month: 12, day: 26 }), false);
  assert.equal(birthdayOfferDue("02-29", null, { year: 2027, month: 2, day: 21 }), true, "no 29 Feb in 2027");
  assert.equal(birthdayOfferDue(null, null, { year: 2026, month: 1, day: 1 }), false);
});

test("local date follows the business time zone", () => {
  assert.deepEqual(localDate(new Date("2026-11-23T20:00:00Z"), "Asia/Kolkata"), { year: 2026, month: 11, day: 24 });
  assert.deepEqual(localDate(new Date("2026-11-23T20:00:00Z"), "America/Toronto"), { year: 2026, month: 11, day: 23 });
});

test("the two new WhatsApp templates exist in all four languages and end with STOP", () => {
  for (const key of ["feedback_request", "birthday_offer"] as const) {
    const d = getDef(key);
    for (const l of ["en", "hinglish", "hi", "pa"] as const) {
      assert.ok(d.bodies[l], `${key} ${l}`);
      assert.match(d.bodies[l]!, /STOP/);
    }
  }
  assert.equal(getDef("feedback_request").category, "UTILITY");
  assert.equal(getDef("birthday_offer").category, "MARKETING");
  assert.ok(WA_TEMPLATE_DEFS.length >= 14);
});

test("wiring: webhook handles ratings and birthdays, cron sends them, plain review request steps aside", () => {
  const hook = readFileSync("app/api/webhook/whatsapp/route.ts", "utf8");
  assert.match(hook, /handleRatingReply\(business, location, customer, text, now\)/);
  assert.match(hook, /handleBirthdayReply\(business, location, customer, text, now\)/);
  const cron = readFileSync("app/api/cron/offers/route.ts", "utf8");
  assert.match(cron, /requestDueFeedback\(now\)/);
  assert.match(cron, /sendBirthdayOffers\(now\)/);
  assert.match(readFileSync("lib/ingest-events.ts", "utf8"), /autoReviewRequest && !fullBusiness\.autoFeedback/);
  assert.match(readFileSync("lib/new-owner.ts", "utf8"), /input\.sector === "RESTAURANT" \? \{ autoFeedback: true, autoBirthday: true \}/);
  assert.match(readFileSync("lib/birthday.ts", "utf8"), /if \(!business\.autoBirthday\) return false;/);
});
