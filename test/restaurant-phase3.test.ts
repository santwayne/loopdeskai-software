// Restaurant Bundle phase 3: Growth Manager restaurant mode, reservations, reviews inbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reservationLine, restaurantWinbackTitle, slowDayOffer, slowestWeekday } from "../lib/restaurant";
import { fallbackReply, reviewKey } from "../lib/review-rules";
import { ACTION_TYPES, ACTION_LABEL, BASE_WIN_RATE, DEFAULT_AUTONOMY } from "../lib/growth/types";
import { getDef } from "../lib/whatsapp-templates";

test("slowest weekday: clearly slow only, with enough bills", () => {
  assert.equal(slowestWeekday([30, 30, 12, 30, 30, 40, 45]), 2, "Tuesday");
  assert.equal(slowestWeekday([30, 30, 28, 30, 30, 40, 45]), null, "not clearly slow");
  assert.equal(slowestWeekday([1, 2, 0, 3, 2, 4, 5]), null, "too few bills");
  assert.equal(slowestWeekday([1, 2, 3]), null);
});

test("slow-day offer and restaurant win-back wording", () => {
  const o = slowDayOffer(2, "Boba Bay Café");
  assert.equal(o.title, "Tuesday combo");
  assert.ok(o.message.includes("Boba Bay Café") && o.message.length <= 500);
  assert.deepEqual(o.segments, ["REGULAR", "HIGH_SPENDER", "AT_RISK"]);
  assert.equal(restaurantWinbackTitle("Simran", 40), "Simran hasn't ordered in 40 days");
});

test("SLOW_DAY_OFFER is a full Growth Manager action that asks first", () => {
  assert.ok(ACTION_TYPES.includes("SLOW_DAY_OFFER"));
  assert.equal(DEFAULT_AUTONOMY.SLOW_DAY_OFFER, "APPROVE");
  assert.ok(ACTION_LABEL.SLOW_DAY_OFFER.one && BASE_WIN_RATE.SLOW_DAY_OFFER > 0);
  const exec = readFileSync("lib/growth/executor.ts", "utf8");
  assert.match(exec, /case "SLOW_DAY_OFFER"[\s\S]*createOffer\(business, owner/);
  const plan = readFileSync("lib/growth/planner.ts", "utf8");
  assert.match(plan, /type: "SLOW_DAY_OFFER"/);
  assert.match(plan, /!business\.autoReviewRequest && !business\.autoFeedback/);
});

test("reservation confirmation line, in IST", () => {
  assert.equal(reservationLine({ kind: "TABLE", partySize: 4, at: new Date("2026-11-28T15:30:00Z") }, "Asia/Kolkata"), "a table for 4 on Sat 28 Nov at 9:00 pm");
  assert.equal(reservationLine({ kind: "TAKEAWAY", items: "2 taro boba", at: new Date("2026-11-28T08:15:00Z") }, "Asia/Kolkata"), "your takeaway order (2 taro boba) for pickup on Sat 28 Nov at 1:45 pm");
  const d = getDef("reservation_confirm");
  assert.equal(d.category, "UTILITY");
  for (const l of ["en", "hinglish", "hi", "pa"] as const) assert.ok(d.bodies[l]);
});

test("reviews: same review twice gets the same key; fallback replies never promise anything", () => {
  assert.equal(reviewKey({ externalId: " z-1 " }), "z-1");
  const a = reviewKey({ reviewerName: "Simran", rating: 2, text: "Cold fries" });
  assert.equal(a, reviewKey({ reviewerName: " simran", rating: 2, text: "cold fries " }));
  assert.notEqual(a, reviewKey({ reviewerName: "Simran", rating: 3, text: "Cold fries" }));
  const low = fallbackReply({ reviewerName: "Simran Gill", rating: 2 }, "Boba Bay Café");
  assert.match(low, /^Hi Simran, we're sorry/);
  assert.ok(!/%|free|discount|₹/i.test(low));
  assert.match(fallbackReply({ rating: 5 }, "Boba Bay Café"), /^thank you/);
});

test("wiring: reservation and reviews APIs, pages and menu", () => {
  const res = readFileSync("app/api/v1/front-desk/reservation/route.ts", "utf8");
  assert.match(res, /templateKey: "reservation_confirm"/);
  assert.match(res, /type: "BOOKING"/);
  assert.ok(readFileSync("app/api/v1/reviews/route.ts", "utf8").includes("addReview"));
  const nav = readFileSync("components/dashboard-nav.tsx", "utf8");
  for (const href of ["/dashboard/counter", "/dashboard/report", "/dashboard/outlets", "/dashboard/reviews"]) assert.ok(nav.includes(href), href);
});
