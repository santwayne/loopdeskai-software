import { Prisma, type Business, type Customer, type Location } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logger";
import { graphSend } from "@/lib/whatsapp-send";
import { whatsappSenderFor } from "@/lib/whatsapp-sender";
import { otpMessage } from "@/lib/whatsapp-otp";
import {
  OTP_TTL_MS, checkOtp, checkRedeemPoints, checkWalletSpend, hashOtp, newOtp, newReferralCode,
  pointsForBill, pointsLapsed, tierFor, type LoyaltySettings, type Tier,
} from "@/lib/loyalty";

/** Reads and writes for points, wallet, redeem codes and referrals (rules: lib/loyalty.ts). */

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function loyaltySettings(b: Business): LoyaltySettings {
  return {
    pointsPer100: b.pointsPer100, pointValuePaise: b.pointValuePaise, pointsExpiryDays: b.pointsExpiryDays,
    minRedeemPoints: b.minRedeemPoints, tierGoldSpend: b.tierGoldSpend, tierVipSpend: b.tierVipSpend,
    referralRewardPoints: b.referralRewardPoints,
  };
}

export async function spendLastYear(customerId: string, now = new Date()) {
  const r = await prisma.visit.aggregate({ where: { customerId, occurredAt: { gte: new Date(now.getTime() - YEAR_MS) } }, _sum: { amount: true } });
  return r._sum.amount ?? 0;
}

export async function customerTier(business: Business, customerId: string, now = new Date()): Promise<Tier> {
  return tierFor(await spendLastYear(customerId, now), loyaltySettings(business));
}

/** A lapsed balance (no bill for pointsExpiryDays) is written off first. */
async function expireIfLapsed(tx: Prisma.TransactionClient, business: Business, c: Customer, now: Date) {
  if (c.points <= 0 || !pointsLapsed(c.lastBillAt, business.pointsExpiryDays, now)) return c;
  await tx.loyaltyEntry.create({ data: { businessId: business.id, customerId: c.id, type: "EXPIRE", points: -c.points, note: `No bill for ${business.pointsExpiryDays} days` } });
  return tx.customer.update({ where: { id: c.id }, data: { points: 0 } });
}

/**
 * Points for one bill (any source: POS, counter, events API). Safe to call
 * twice for the same visit: LoyaltyEntry.visitId is unique. Also pays the
 * referral reward on a referred customer's first bill.
 */
export async function awardForVisit(business: Business, visit: { id: string; amount: number | null; customerId: string; locationId: string; occurredAt: Date }, now = new Date()) {
  if (!business.loyaltyEnabled) return { points: 0 };
  const tier = await customerTier(business, visit.customerId, now);
  const points = pointsForBill(visit.amount, business, tier);
  try {
    await prisma.$transaction(async (tx) => {
      let c = await tx.customer.findUniqueOrThrow({ where: { id: visit.customerId } });
      c = await expireIfLapsed(tx, business, c, visit.occurredAt);
      await tx.loyaltyEntry.create({
        data: { businessId: business.id, customerId: c.id, locationId: visit.locationId, type: "EARN", points, visitId: visit.id, note: `Bill ₹${visit.amount ?? 0} (${tier})` },
      });
      const later = !c.lastBillAt || visit.occurredAt > c.lastBillAt;
      await tx.customer.update({ where: { id: c.id }, data: { points: { increment: points }, ...(later ? { lastBillAt: visit.occurredAt } : {}) } });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { points: 0 }; // already awarded
    throw err;
  }
  await payReferralReward(business, visit.customerId, now).catch((err) =>
    logEvent({ businessId: business.id, source: "LOYALTY", level: "ERROR", message: "Referral reward failed", meta: { error: String(err) } }));
  return { points, tier };
}

/** First bill of a referred customer: both get referralRewardPoints, once. */
async function payReferralReward(business: Business, customerId: string, now: Date) {
  const reward = business.referralRewardPoints;
  if (reward <= 0) return;
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.customer.updateMany({ where: { id: customerId, referredById: { not: null }, referralRewardedAt: null }, data: { referralRewardedAt: now } });
    if (!claimed.count) return;
    const friend = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
    const referrer = await tx.customer.findFirst({ where: { id: friend.referredById!, businessId: business.id } });
    for (const c of [friend, referrer]) {
      if (!c) continue;
      await tx.loyaltyEntry.create({ data: { businessId: business.id, customerId: c.id, type: "REFERRAL", points: reward, note: c.id === friend.id ? "Joined with a friend's code" : `Referred ${friend.name ?? "a friend"}` } });
      await tx.customer.update({ where: { id: c.id }, data: { points: { increment: reward } } });
    }
  });
}

/** "JOIN … REF ABC234": remember who referred a new customer (not themselves, same business). */
export async function applyReferralOnJoin(customer: Customer, code: string) {
  if (customer.referredById || customer.visitCount > 0) return false;
  const referrer = await prisma.customer.findFirst({ where: { businessId: customer.businessId, referralCode: code } });
  if (!referrer || referrer.id === customer.id || referrer.phone === customer.phone) return false;
  await prisma.customer.update({ where: { id: customer.id }, data: { referredById: referrer.id } });
  return true;
}

export async function ensureReferralCode(customer: Customer): Promise<string> {
  if (customer.referralCode) return customer.referralCode;
  for (let i = 0; i < 5; i++) {
    const code = newReferralCode();
    try {
      await prisma.customer.update({ where: { id: customer.id }, data: { referralCode: code } });
      return code;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
  throw new Error("Could not make a referral code");
}

// ── Counter: redeem with a WhatsApp code ────────────────────────────────

export type RedeemKind = "POINTS" | "WALLET";

export async function startRedeem(business: Business, location: Location, customer: Customer, kind: RedeemKind, amount: number, staffId: string | null, now = new Date()) {
  if (!business.loyaltyEnabled) return { ok: false as const, error: "Loyalty is switched off in Settings." };
  const check = kind === "POINTS" ? checkRedeemPoints(customer.points, amount, business) : checkWalletSpend(customer.walletPaise, amount);
  if (!check.ok) return check;
  const sender = whatsappSenderFor(location, business);
  if (!sender) return { ok: false as const, error: "WhatsApp isn't connected for this outlet, so a code can't be sent." };
  const code = newOtp();
  const req = await prisma.redeemRequest.create({
    data: { businessId: business.id, customerId: customer.id, locationId: location.id, kind, amount, codeHash: "pending", expiresAt: new Date(now.getTime() + OTP_TTL_MS), createdById: staffId },
  });
  await prisma.redeemRequest.update({ where: { id: req.id }, data: { codeHash: hashOtp(code, req.id) } });
  const r = await graphSend(sender, customer.phone, otpMessage(code));
  if (!r.ok) {
    await prisma.redeemRequest.update({ where: { id: req.id }, data: { usedAt: now } }); // void it
    return { ok: false as const, error: `The code couldn't be sent on WhatsApp (${r.error ?? "unknown error"}).` };
  }
  return { ok: true as const, requestId: req.id };
}

export async function confirmRedeem(business: Business, requestId: string, code: string, staffId: string | null, now = new Date()) {
  const req = await prisma.redeemRequest.findFirst({ where: { id: requestId, businessId: business.id } });
  if (!req) return { ok: false as const, error: "That request wasn't found. Start again." };
  const result = checkOtp(req, code, now);
  if (result !== "OK") {
    if (result === "WRONG") await prisma.redeemRequest.update({ where: { id: req.id }, data: { attempts: { increment: 1 } } });
    const text = { WRONG: "Wrong code. Ask the customer to read it again.", EXPIRED: "The code has expired. Send a new one.", USED: "This code was already used.", TOO_MANY: "Too many wrong tries. Send a new code." }[result];
    return { ok: false as const, error: text };
  }
  return prisma.$transaction(async (tx) => {
    const used = await tx.redeemRequest.updateMany({ where: { id: req.id, usedAt: null }, data: { usedAt: now } });
    if (!used.count) return { ok: false as const, error: "This code was already used." };
    const c = await tx.customer.findUniqueOrThrow({ where: { id: req.customerId } });
    if (req.kind === "POINTS") {
      if (c.points < req.amount) return { ok: false as const, error: `Only ${c.points} points available now.` };
      await tx.customer.update({ where: { id: c.id }, data: { points: { decrement: req.amount } } });
      await tx.loyaltyEntry.create({ data: { businessId: business.id, customerId: c.id, locationId: req.locationId, type: "REDEEM", points: -req.amount, createdById: staffId } });
      return { ok: true as const, points: c.points - req.amount, walletPaise: c.walletPaise };
    }
    if (c.walletPaise < req.amount) return { ok: false as const, error: "Not enough in the wallet now." };
    await tx.customer.update({ where: { id: c.id }, data: { walletPaise: { decrement: req.amount } } });
    await tx.loyaltyEntry.create({ data: { businessId: business.id, customerId: c.id, locationId: req.locationId, type: "WALLET_SPEND", walletPaise: -req.amount, createdById: staffId } });
    return { ok: true as const, points: c.points, walletPaise: c.walletPaise - req.amount };
  });
}

/** Prepaid wallet: staff record money the customer paid in. */
export async function walletTopup(business: Business, customer: Customer, paise: number, staffId: string | null, locationId: string | null, note?: string) {
  if (!Number.isInteger(paise) || paise <= 0 || paise > 10_000_000) return { ok: false as const, error: "Enter an amount between ₹1 and ₹1,00,000." };
  await prisma.$transaction([
    prisma.customer.update({ where: { id: customer.id }, data: { walletPaise: { increment: paise } } }),
    prisma.loyaltyEntry.create({ data: { businessId: business.id, customerId: customer.id, locationId, type: "WALLET_TOPUP", walletPaise: paise, note: note ?? null, createdById: staffId } }),
  ]);
  return { ok: true as const, walletPaise: customer.walletPaise + paise };
}

/** Hourly: write off balances of customers with no bill for pointsExpiryDays. */
export async function expireLapsedPoints(now = new Date()) {
  const businesses = await prisma.business.findMany({ where: { status: "ACTIVE", loyaltyEnabled: true } });
  let expired = 0;
  for (const b of businesses) {
    if (b.pointsExpiryDays <= 0) continue;
    const cutoff = new Date(now.getTime() - b.pointsExpiryDays * 24 * 60 * 60 * 1000);
    const lapsed = await prisma.customer.findMany({ where: { businessId: b.id, points: { gt: 0 }, lastBillAt: { lt: cutoff } }, take: 1000 });
    for (const c of lapsed) {
      await prisma.$transaction(async (tx) => { await expireIfLapsed(tx, b, await tx.customer.findUniqueOrThrow({ where: { id: c.id } }), now); });
      expired++;
    }
  }
  return { expired };
}
