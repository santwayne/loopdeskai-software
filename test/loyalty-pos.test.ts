// Restaurant Bundle phase 2: loyalty rules, POS parsing, monthly report maths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_LOYALTY, checkOtp, checkRedeemPoints, checkWalletSpend, hashOtp, newOtp, newReferralCode,
  parseReferral, pointsForBill, pointsLapsed, pointsValueRupees, referralLink, tierFor,
} from "../lib/loyalty";
import { billToEvent, newPosToken, normalizePhone, parseGeneric, parsePetpooja, posTime } from "../lib/pos";
import { monthBounds, previousMonth, reportLine, tzOffsetMinutes, type MonthlyReport } from "../lib/report-rules";
import { otpMessage, otpTemplatePayload } from "../lib/whatsapp-otp";

const S = DEFAULT_LOYALTY;

test("points: per ₹100, rounded down, with tier bonus", () => {
  assert.equal(pointsForBill(640, S), 30);
  assert.equal(pointsForBill(99, S), 0);
  assert.equal(pointsForBill(null, S), 0);
  assert.equal(pointsForBill(1000, S, "GOLD"), 62);
  assert.equal(pointsForBill(1000, S, "VIP"), 75);
  assert.equal(pointsValueRupees(30, S), 30);
  assert.equal(pointsValueRupees(30, { pointValuePaise: 50 }), 15);
});

test("tiers by last-year spend", () => {
  assert.equal(tierFor(0, S), "SILVER");
  assert.equal(tierFor(5000, S), "GOLD");
  assert.equal(tierFor(15000, S), "VIP");
  assert.equal(tierFor(99999, { tierGoldSpend: 0, tierVipSpend: 0 }), "SILVER", "0 switches a tier off");
});

test("redeem limits", () => {
  assert.equal(checkRedeemPoints(200, 60, S).ok, true);
  assert.equal(checkRedeemPoints(200, 40, S).ok, false, "below minimum");
  assert.equal(checkRedeemPoints(50, 60, S).ok, false, "more than balance");
  assert.equal(checkRedeemPoints(200, 1.5, S).ok, false);
  assert.equal(checkWalletSpend(50000, 50000).ok, true);
  assert.equal(checkWalletSpend(50000, 50001).ok, false);
});

test("inactivity expiry", () => {
  const now = new Date("2026-11-23T00:00:00Z");
  assert.equal(pointsLapsed(new Date("2026-05-01T00:00:00Z"), 180, now), true);
  assert.equal(pointsLapsed(new Date("2026-10-01T00:00:00Z"), 180, now), false);
  assert.equal(pointsLapsed(new Date("2020-01-01T00:00:00Z"), 0, now), false, "0 = never");
});

test("OTP: 6 digits, hashed with a salt, expiry, tries, single use", () => {
  const code = newOtp();
  assert.match(code, /^\d{6}$/);
  const now = new Date();
  const req = { id: "r1", codeHash: hashOtp(code, "r1"), expiresAt: new Date(now.getTime() + 60_000), usedAt: null, attempts: 0 };
  assert.notEqual(hashOtp(code, "r1"), hashOtp(code, "r2"));
  assert.equal(checkOtp(req, code, now), "OK");
  assert.equal(checkOtp(req, code === "000000" ? "111111" : "000000", now), "WRONG");
  assert.equal(checkOtp({ ...req, attempts: 5 }, code, now), "TOO_MANY");
  assert.equal(checkOtp({ ...req, usedAt: now }, code, now), "USED");
  assert.equal(checkOtp(req, code, new Date(now.getTime() + 120_000)), "EXPIRED");
});

test("OTP template is Meta's AUTHENTICATION shape with a copy-code button", () => {
  const t = otpTemplatePayload();
  assert.equal(t.category, "AUTHENTICATION");
  assert.ok(t.components.some((c) => c.type === "BUTTONS"));
  const m = otpMessage("123456");
  assert.equal(m.template.components[0].parameters[0].text, "123456");
  assert.equal(m.template.components[1].parameters[0].text, "123456");
});

test("referral codes and the join link", () => {
  const c = newReferralCode();
  assert.match(c, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(parseReferral("JOIN K7Q2MX REF abc234"), "ABC234");
  assert.equal(parseReferral("JOIN K7Q2MX REF OI0123"), null, "0/O/1/I never appear in codes");
  assert.equal(parseReferral("JOIN K7Q2MX"), null);
  assert.equal(referralLink("+91 90414 36801", "K7Q2MX", "ABC234"), "https://wa.me/919041436801?text=JOIN%20K7Q2MX%20REF%20ABC234");
  // "REF" is not mistaken for a table tag (lib/onboarding.ts parseJoin).
  assert.ok(readFileSync("lib/onboarding.ts", "utf8").includes("(?:\\s+(?!ref\\b)([a-z0-9-]{1,20}))?"));
});

test("phones: Indian numbers in any form", () => {
  for (const raw of ["9876543210", "+91 98765 43210", "09876543210", "919876543210", "0091-9876543210"]) assert.equal(normalizePhone(raw), "919876543210", raw);
  assert.equal(normalizePhone("1234567890"), null, "not a mobile");
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone("4165550123", "1"), "14165550123");
});

test("POS times: Petpooja local time → IST offset", () => {
  assert.equal(posTime("2026-11-23 13:45:10"), "2026-11-23T13:45:10+05:30");
  assert.equal(posTime("2026-11-23 13:45"), "2026-11-23T13:45:00+05:30");
  assert.equal(posTime("nope"), null);
});

const order = { orderID: "1042", status: "Success", total: "640.00", created_on: "2026-11-23 13:45:10" };
const customer = { name: "Simran Gill", phone: "9876543210" };

test("Petpooja: all the payload wrappings seen in the wild", () => {
  const shapes = [
    { token: "x", properties: { Restaurant: { restID: "abc12" }, Customer: customer, Order: order, OrderItem: [{ name: "Taro boba", quantity: "2", price: "220" }] }, event: "orderdetails" },
    { orderinfo: { Restaurant: { restID: "abc12" }, Customer: customer, Order: order, OrderItem: [] } },
    { orderinfo: { OrderInfo: { Restaurant: { details: { restID: "abc12" } }, Customer: { details: customer }, Order: { details: order }, OrderItem: { details: [] } } } },
    { OrderInfo: { restaurant: { res_id: "abc12" }, customer: { name: "Simran Gill", mobile: "+91 98765 43210" }, order: { order_id: "1042", grand_total: 640, order_date: "2026-11-23 13:45:10" } } },
  ];
  for (const [i, p] of shapes.entries()) {
    const r = parsePetpooja(p);
    assert.ok(r.ok, `shape ${i}: ${!r.ok && r.error}`);
    if (!r.ok) continue;
    assert.equal(r.bill.orderId, "1042");
    assert.equal(r.bill.phone, "919876543210");
    assert.equal(r.bill.amount, 640);
    assert.equal(r.bill.restId, "abc12");
    assert.equal(r.bill.occurredAt, "2026-11-23T13:45:10+05:30");
  }
  const first = parsePetpooja(shapes[0]);
  assert.ok(first.ok && first.bill.items[0].name === "Taro boba" && first.bill.items[0].qty === 2);
});

test("Petpooja: cancelled or phone-less bills are skipped, broken ones refused", () => {
  const cancelled = parsePetpooja({ properties: { Customer: customer, Order: { ...order, status: "Cancelled" } } });
  assert.ok(!cancelled.ok && cancelled.reason === "IGNORED");
  const noPhone = parsePetpooja({ properties: { Customer: { name: "Walk-in" }, Order: order } });
  assert.ok(!noPhone.ok && noPhone.reason === "IGNORED");
  const broken = parsePetpooja({ hello: 1 });
  assert.ok(!broken.ok && broken.reason === "INVALID");
});

test("generic POS format and the VISIT event it becomes", () => {
  const r = parseGeneric({ orderId: "B-9", phone: "98765 43210", name: "Arjun", amount: 300, occurredAt: "2026-11-23T10:00:00+05:30" });
  assert.ok(r.ok);
  if (!r.ok) return;
  const ev = billToEvent("generic", r.bill, "loc1");
  assert.equal(ev.type, "VISIT");
  assert.equal(ev.externalId, "pos:generic:-:B-9");
  assert.equal(ev.locationId, "loc1");
  assert.equal(ev.amount, 300);
  assert.match(newPosToken(), /^pos_[a-f0-9]{36}$/);
});

test("monthly report: month bounds in IST, previous month, one-line summary", () => {
  assert.equal(tzOffsetMinutes("Asia/Kolkata", new Date("2026-11-15T12:00:00Z")), 330);
  const b = monthBounds("2026-11", 330);
  assert.equal(b.start.toISOString(), "2026-10-31T18:30:00.000Z");
  assert.equal(b.end.toISOString(), "2026-11-30T18:30:00.000Z");
  assert.equal(b.label, "Nov 2026");
  assert.equal(previousMonth({ year: 2027, month: 1 }), "2026-12");
  const r: MonthlyReport = {
    month: "2026-11", label: "Nov 2026", bills: 640, revenue: 210000, newCustomers: 80, returningRevenue: 150000,
    winbacks: { count: 12, value: 6200 }, referrals: { customers: 9, revenue: 4100 }, messageReturns: { customers: 20, revenue: 8100 },
    earned: 18400, ratings: { count: 50, avg: 4.4, toReviews: 41, caught: 9 }, pointsRedeemed: 3000, byOutlet: [],
  };
  const line = reportLine(r, (v) => `₹${v}`);
  assert.match(line, /^Loopdesk brought in ₹18400/);
  assert.ok(!/\n/.test(line), "template variables can't hold new lines");
});

test("wiring: bills earn points, cron runs expiry + report, join handles REF, counter + POS routes exist", () => {
  assert.match(readFileSync("lib/ingest-events.ts", "utf8"), /awardForVisit\(loyaltyBusiness, visit\)/);
  const cron = readFileSync("app/api/cron/offers/route.ts", "utf8");
  assert.match(cron, /expireLapsedPoints\(now\)/);
  assert.match(cron, /sendMonthlyReports\(now\)/);
  const hook = readFileSync("app/api/webhook/whatsapp/route.ts", "utf8");
  assert.match(hook, /applyReferralOnJoin\(joined, ref\)/);
  assert.ok(readFileSync("app/api/v1/pos/[provider]/[token]/route.ts", "utf8").includes("ingestEvents"));
  assert.ok(readFileSync("app/api/counter/route.ts", "utf8").includes("confirmRedeem"));
  assert.match(readFileSync("lib/whatsapp-template-sync.ts", "utf8"), /otpTemplatePayload\(\)/);
});
