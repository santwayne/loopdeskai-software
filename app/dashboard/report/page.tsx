import Link from "next/link";
import { getOwnerBusinessOrRedirect } from "@/lib/session";
import { getSettings, money } from "@/lib/growth/settings";
import { buildMonthlyReport, previousMonth } from "@/lib/monthly-report";
import { localDate } from "@/lib/restaurant";
import { StatCard } from "@/components/stat-card";

export const dynamic = "force-dynamic";

/** "Is mahine Loopdesk ne ₹X kamaye" — the month's money, with what counts. */
export default async function ReportPage({ searchParams }: { searchParams: { month?: string } }) {
  const business = await getOwnerBusinessOrRedirect();
  if (!business) return null;
  const s = await getSettings(business);
  const today = localDate(new Date(), s.timezone);
  const thisMonth = `${today.year}-${String(today.month).padStart(2, "0")}`;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month ?? "") && searchParams.month! <= thisMonth ? searchParams.month! : thisMonth;
  const r = await buildMonthlyReport(business, month);
  const fmt = (v: number) => money(s, v);
  const [y, m] = month.split("-").map(Number);
  const prev = previousMonth({ year: y, month: m });
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Report · {r.label}{month === thisMonth ? " (so far)" : ""}</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">Money we can tie to something Loopdesk did. It goes to your WhatsApp on the 1st of every month.</p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href={`/dashboard/report?month=${prev}`} className="rounded-full border border-control px-3 py-1.5 hover:bg-gray-50">← {prev}</Link>
          {month < thisMonth && <Link href={`/dashboard/report?month=${next}`} className="rounded-full border border-control px-3 py-1.5 hover:bg-gray-50">{next} →</Link>}
        </div>
      </div>

      <div className="rounded-card border border-brand-200 bg-brand-50 p-5">
        <p className="text-sm text-gray-700">Loopdesk brought in</p>
        <p className="text-3xl font-semibold">{fmt(r.earned)}</p>
        <p className="mt-1 text-sm text-gray-600">Win-backs {fmt(r.winbacks.value)} + referred customers {fmt(r.referrals.revenue)} + came back after an offer {fmt(r.messageReturns.revenue)}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Win-backs" value={r.winbacks.count} hint={fmt(r.winbacks.value)} />
        <StatCard label="Referred customers" value={r.referrals.customers} hint={fmt(r.referrals.revenue)} />
        <StatCard label="Came back after an offer" value={r.messageReturns.customers} hint={`${fmt(r.messageReturns.revenue)} · first bill within 14 days`} />
        <StatCard label="Points used" value={r.pointsRedeemed} />
        <StatCard label="Bills" value={r.bills} hint={fmt(r.revenue)} />
        <StatCard label="From returning customers" value={fmt(r.returningRevenue)} />
        <StatCard label="New customers" value={r.newCustomers} />
        <StatCard label="Ratings" value={r.ratings.avg != null ? `${r.ratings.avg.toFixed(1)} / 5` : "—"} hint={`${r.ratings.toReviews} sent to Google · ${r.ratings.caught} unhappy caught`} />
      </div>

      {r.byOutlet.length > 1 && (
        <div className="overflow-x-auto rounded-card border border-gray-200 bg-white">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-gray-50 text-left text-gray-500"><tr><th className="px-4 py-2 font-medium">Outlet</th><th className="px-4 py-2 font-medium">Bills</th><th className="px-4 py-2 font-medium">Revenue</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {r.byOutlet.map((o) => <tr key={o.locationId}><td className="px-4 py-2">{o.name}</td><td className="px-4 py-2">{o.bills}</td><td className="px-4 py-2">{fmt(o.revenue)}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">Bills come from your POS, the Counter screen or WhatsApp. A win-back counts when the Growth Manager marks it won. Customers counted as referred or won back aren&apos;t counted again under offers.</p>
    </div>
  );
}
