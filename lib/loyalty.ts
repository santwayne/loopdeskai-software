import { createHash, randomInt } from "crypto";

/**
 * Restaurant Bundle phase 2 (Nov 2026): points, tiers, wallet, OTP redeem,
 * referrals. The rules, with no database access (test/loyalty.test.ts);
 * lib/loyalty-db.ts does the reads and writes.
 *
 *  - Points: `pointsPer100` points for every ₹100 of a bill (rounded down).
 *    1 point is worth `pointValuePaise` (default 100 = ₹1).
 *  - Expiry: the whole balance lapses after `pointsExpiryDays` with no bill
 *    (inactivity expiry: a regular never loses points, a lapsed one does).
 *  - Tiers: Silver (member), Gold, VIP by spend in the last 365 days.
 *  - Redeem points or wallet balance at the counter only with a WhatsApp code
 *    (6 digits, 10 minutes, 5 tries).
 *  - Referral: each customer has a 6-letter code; a friend who joins with it
 *    and gets a first bill earns both of them `referralRewardPoints`.
 */

export type LoyaltySettings = {
  pointsPer100: number;
  pointValuePaise: number;
  pointsExpiryDays: number;
  minRedeemPoints: number;
  tierGoldSpend: number;
  tierVipSpend: number;
  referralRewardPoints: number;
};

export const DEFAULT_LOYALTY: LoyaltySettings = {
  pointsPer100: 5, pointValuePaise: 100, pointsExpiryDays: 180, minRedeemPoints: 50,
  tierGoldSpend: 5000, tierVipSpend: 15000, referralRewardPoints: 50,
};

/** Tier multipliers on points earned. */
const TIER_BONUS: Record<Tier, number> = { SILVER: 1, GOLD: 1.25, VIP: 1.5 };

export type Tier = "SILVER" | "GOLD" | "VIP";
export const TIER_LABEL: Record<Tier, string> = { SILVER: "Silver", GOLD: "Gold", VIP: "VIP" };

export function tierFor(spendLastYear: number, s: Pick<LoyaltySettings, "tierGoldSpend" | "tierVipSpend">): Tier {
  if (s.tierVipSpend > 0 && spendLastYear >= s.tierVipSpend) return "VIP";
  if (s.tierGoldSpend > 0 && spendLastYear >= s.tierGoldSpend) return "GOLD";
  return "SILVER";
}

/** Points for one bill (₹ amount), with the tier bonus. */
export function pointsForBill(amount: number | null | undefined, s: Pick<LoyaltySettings, "pointsPer100">, tier: Tier = "SILVER"): number {
  if (!amount || amount <= 0 || s.pointsPer100 <= 0) return 0;
  return Math.floor((Math.floor(amount / 100) * s.pointsPer100) * TIER_BONUS[tier]);
}

/** ₹ value of points. */
export function pointsValueRupees(points: number, s: Pick<LoyaltySettings, "pointValuePaise">) {
  return Math.round(points * s.pointValuePaise) / 100;
}

export type RedeemCheck = { ok: true } | { ok: false; error: string };

export function checkRedeemPoints(balance: number, points: number, s: Pick<LoyaltySettings, "minRedeemPoints">): RedeemCheck {
  if (!Number.isInteger(points) || points <= 0) return { ok: false, error: "Enter the points to use." };
  if (points < s.minRedeemPoints) return { ok: false, error: `At least ${s.minRedeemPoints} points can be used at a time.` };
  if (points > balance) return { ok: false, error: `Only ${balance} points available.` };
  return { ok: true };
}

export function checkWalletSpend(balancePaise: number, paise: number): RedeemCheck {
  if (!Number.isInteger(paise) || paise <= 0) return { ok: false, error: "Enter the amount to use." };
  if (paise > balancePaise) return { ok: false, error: `Only ₹${(balancePaise / 100).toFixed(2)} in the wallet.` };
  return { ok: true };
}

/** The balance has lapsed: no bill for `days` days. */
export function pointsLapsed(lastBillAt: Date | null | undefined, days: number, now: Date) {
  if (!lastBillAt || days <= 0) return false;
  return now.getTime() - lastBillAt.getTime() > days * 24 * 60 * 60 * 1000;
}

// ── OTP ─────────────────────────────────────────────────────────────────
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_TRIES = 5;

export function newOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Stored as a hash, salted with the request id so equal codes don't match. */
export function hashOtp(code: string, salt: string) {
  return createHash("sha256").update(`${salt}:${code.trim()}`).digest("hex");
}

export type OtpCheck = "OK" | "EXPIRED" | "USED" | "TOO_MANY" | "WRONG";
export function checkOtp(
  req: { codeHash: string; expiresAt: Date; usedAt: Date | null; attempts: number; id: string }, code: string, now: Date,
): OtpCheck {
  if (req.usedAt) return "USED";
  if (req.attempts >= OTP_MAX_TRIES) return "TOO_MANY";
  if (now > req.expiresAt) return "EXPIRED";
  return hashOtp(code, req.id) === req.codeHash ? "OK" : "WRONG";
}

// ── Referral ────────────────────────────────────────────────────────────
/** No 0/O/1/I so codes are easy to read out at the counter. */
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newReferralCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[randomInt(0, REF_ALPHABET.length)];
  return s;
}

/** "JOIN K7Q2MX REF ABC234" → "ABC234". */
export function parseReferral(text: string | null | undefined): string | null {
  const m = String(text ?? "").match(/\bref\s+([a-z0-9]{6})\b/i);
  if (!m) return null;
  const code = m[1].toUpperCase();
  return [...code].every((c) => REF_ALPHABET.includes(c)) ? code : null;
}

/** The friend's join link: the business's QR join text plus "REF <code>". */
export function referralLink(displayNumber: string, joinCode: string, referralCode: string) {
  return `https://wa.me/${displayNumber.replace(/\D/g, "")}?text=${encodeURIComponent(`JOIN ${joinCode} REF ${referralCode}`)}`;
}
