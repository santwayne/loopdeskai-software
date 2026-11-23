import type { Business } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logger";
import { getSettings, money } from "@/lib/growth/settings";
import { ownerChannel } from "@/lib/growth/brief";
import { sendOwnerWhatsApp } from "@/lib/whatsapp-send";
import { localDate } from "@/lib/restaurant";
import { monthBounds, previousMonth, reportLine, tzOffsetMinutes, type MonthlyReport } from "@/lib/report-rules";

export { monthBounds, previousMonth, reportLine, tzOffsetMinutes };

/**
 * "Is mahine Loopdesk ne ₹X kamaye" (Restaurant Bundle phase 2).
 *
 * Earned by Loopdesk = only money we can tie to something Loopdesk did:
 *   - win-backs the Growth Manager marked WON (their outcomeValue)
 *   - every bill this month from customers who joined with a friend's code
 *   - bills from customers who came back within 14 days of an offer or
 *     win-back message (first bill after the message only)
 * Plus context lines: revenue, bills, returning-customer revenue, ratings,
 * points used. Sent to the owner on WhatsApp on the 1st (local date) for the
 * month before; the full page is Dashboard → Report.
 */

export type { MonthlyReport } from "@/lib/report-rules";

const RETURN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export async function buildMonthlyReport(business: Business, ym: string): Promise<MonthlyReport> {
  const s = await getSettings(business);
  const { start, end, label } = monthBounds(ym, tzOffsetMinutes(s.timezone, new Date(`${ym}-15T12:00:00Z`)));
  const inMonth = { gte: start, lt: end };

  const [visits, newCustomers, wins, ratings, redeemed, locations, messages] = await Promise.all([
    prisma.visit.findMany({ where: { businessId: business.id, occurredAt: inMonth }, select: { id: true, amount: true, customerId: true, locationId: true, occurredAt: true, rating: true, customer: { select: { firstSeenAt: true, referredById: true } } } }),
    prisma.customer.count({ where: { businessId: business.id, firstSeenAt: inMonth } }),
    prisma.growthAction.findMany({ where: { businessId: business.id, outcome: "WON", outcomeAt: inMonth }, select: { outcomeValue: true, customerId: true } }),
    prisma.visit.findMany({ where: { businessId: business.id, ratedAt: inMonth, rating: { not: null } }, select: { rating: true } }),
    prisma.loyaltyEntry.aggregate({ where: { businessId: business.id, type: "REDEEM", createdAt: inMonth }, _sum: { points: true } }),
    prisma.location.findMany({ where: { businessId: business.id }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    prisma.message.findMany({
      where: { businessId: business.id, direction: "OUTBOUND", status: { in: ["SENT", "DELIVERED", "READ"] }, purpose: { in: ["OFFER", "WINBACK"] }, createdAt: { gte: new Date(start.getTime() - RETURN_WINDOW_MS), lt: end } },
      select: { customerId: true, createdAt: true },
    }),
  ]);

  const amt = (v: { amount: number | null }) => v.amount ?? 0;
  const revenue = visits.reduce((t, v) => t + amt(v), 0);
  const returningRevenue = visits.filter((v) => v.customer.firstSeenAt < start).reduce((t, v) => t + amt(v), 0);

  const referred = visits.filter((v) => v.customer.referredById);
  const referralRevenue = referred.reduce((t, v) => t + amt(v), 0);

  // First bill within 14 days after an offer/win-back message (not already counted as referral or win-back).
  const wonCustomers = new Set(wins.map((w) => w.customerId).filter(Boolean) as string[]);
  const lastMsg = new Map<string, Date[]>();
  for (const m of messages) if (m.customerId) lastMsg.set(m.customerId, [...(lastMsg.get(m.customerId) ?? []), m.createdAt]);
  const returned = new Map<string, number>();
  for (const v of [...visits].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    if (returned.has(v.customerId) || v.customer.referredById || wonCustomers.has(v.customerId)) continue;
    const sent = lastMsg.get(v.customerId);
    if (sent?.some((t) => t < v.occurredAt && v.occurredAt.getTime() - t.getTime() <= RETURN_WINDOW_MS)) returned.set(v.customerId, amt(v));
  }
  const messageRevenue = [...returned.values()].reduce((t, x) => t + x, 0);
  const winValue = wins.reduce((t, w) => t + (w.outcomeValue ?? 0), 0);

  const rated = ratings.map((r) => r.rating!);
  const byOutlet = locations.map((l) => {
    const vs = visits.filter((v) => v.locationId === l.id);
    return { locationId: l.id, name: l.name, bills: vs.length, revenue: vs.reduce((t, v) => t + amt(v), 0) };
  });

  const round = (v: number) => Math.round(v);
  return {
    month: ym, label,
    bills: visits.length, revenue: round(revenue), newCustomers, returningRevenue: round(returningRevenue),
    winbacks: { count: wins.length, value: round(winValue) },
    referrals: { customers: new Set(referred.map((v) => v.customerId)).size, revenue: round(referralRevenue) },
    messageReturns: { customers: returned.size, revenue: round(messageRevenue) },
    earned: round(winValue + referralRevenue + messageRevenue),
    ratings: { count: rated.length, avg: rated.length ? rated.reduce((t, r) => t + r, 0) / rated.length : null, toReviews: rated.filter((r) => r >= 4).length, caught: rated.filter((r) => r <= 3).length },
    pointsRedeemed: -(redeemed._sum.points ?? 0),
    byOutlet,
  };
}

/** Hourly: on the 1st (local date), send last month's report once. */
export async function sendMonthlyReports(now = new Date()) {
  const businesses = await prisma.business.findMany({ where: { status: "ACTIVE", monthlyReport: true, bundleStatus: "ACTIVE" }, include: { locations: true } });
  let sent = 0;
  for (const b of businesses) {
    const s = await getSettings(b);
    const today = localDate(now, s.timezone);
    if (today.day !== 1) continue;
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: s.timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
    if (hour < 9) continue; // a civil hour
    const ym = previousMonth(today);
    if (b.lastMonthlyReportFor === ym) continue;
    const claimed = await prisma.business.updateMany({ where: { id: b.id, OR: [{ lastMonthlyReportFor: null }, { NOT: { lastMonthlyReportFor: ym } }] }, data: { lastMonthlyReportFor: ym } });
    if (!claimed.count) continue;
    const ch = ownerChannel(s, b);
    if (!ch.ok || ch.channel !== "WHATSAPP") {
      await logEvent({ businessId: b.id, source: "REPORT", level: "WARN", message: `Monthly report not sent: ${ch.ok ? "owner gets SMS" : ch.reason}` });
      continue;
    }
    const r = await buildMonthlyReport(b, ym);
    const loc = b.locations.find((l) => l.status === "ACTIVE") ?? b.locations[0];
    const res = await sendOwnerWhatsApp(b, loc, ch.to, { templateKey: "owner_monthly_report", params: [b.name, r.label, reportLine(r, (v) => money(s, v))] });
    if (res) sent++;
  }
  return { sent };
}
