/**
 * Pure parts of the monthly ₹ report (lib/monthly-report.ts): month bounds in
 * a time zone and the one-line WhatsApp summary. No DB, so tests can load it.
 */

export type MonthlyReport = {
  month: string; label: string;
  bills: number; revenue: number; newCustomers: number; returningRevenue: number;
  winbacks: { count: number; value: number };
  referrals: { customers: number; revenue: number };
  messageReturns: { customers: number; revenue: number };
  earned: number;
  ratings: { count: number; avg: number | null; toReviews: number; caught: number };
  pointsRedeemed: number;
  byOutlet: { locationId: string; name: string; bills: number; revenue: number }[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11" → its start and end as instants in the business time zone. */
export function monthBounds(ym: string, offsetMinutes: number) {
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - offsetMinutes * 60_000);
  const end = new Date(Date.UTC(y, m, 1) - offsetMinutes * 60_000);
  return { start, end, label: `${MONTHS[m - 1]} ${y}` };
}

export function previousMonth(today: { year: number; month: number }) {
  const y = today.month === 1 ? today.year - 1 : today.year;
  const m = today.month === 1 ? 12 : today.month - 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Minutes ahead of UTC for a time zone at a moment (IST = 330). */
export function tzOffsetMinutes(timeZone: string, at: Date) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Math.round((Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - at.getTime()) / 60_000);
}

/** The one-line WhatsApp summary (template variable: no new lines). */
export function reportLine(r: MonthlyReport, fmt: (v: number) => string) {
  const parts = [
    `Loopdesk brought in ${fmt(r.earned)}`,
    r.winbacks.count ? `${r.winbacks.count} win-backs ${fmt(r.winbacks.value)}` : null,
    r.referrals.customers ? `${r.referrals.customers} referred customers ${fmt(r.referrals.revenue)}` : null,
    r.messageReturns.customers ? `${r.messageReturns.customers} came back after an offer ${fmt(r.messageReturns.revenue)}` : null,
    `${r.bills} bills, ${fmt(r.revenue)} total`,
    r.ratings.count ? `rating ${r.ratings.avg?.toFixed(1)}/5, ${r.ratings.toReviews} sent to Google, ${r.ratings.caught} unhappy customers caught early` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
