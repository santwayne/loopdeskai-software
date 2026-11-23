import { prisma } from "@/lib/prisma";
import { getOwnerBusinessOrRedirect } from "@/lib/session";
import { getSettings, money } from "@/lib/growth/settings";
import { termsForSector } from "@/lib/restaurant";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Multi-outlet view (Restaurant Bundle phase 2): each outlet's last 30 days
 * side by side, with a total row. Customers belong to one outlet each
 * (Customer.locationId), so the same phone at two outlets counts twice.
 */
export default async function OutletsPage({ searchParams }: { searchParams: { days?: string } }) {
  const business = await getOwnerBusinessOrRedirect();
  if (!business) return null;
  const days = [7, 30, 90].includes(Number(searchParams.days)) ? Number(searchParams.days) : 30;
  const since = new Date(Date.now() - days * DAY);
  const s = await getSettings(business);
  const terms = termsForSector(business.sector);

  const [locations, bills, customers, newCustomers, ratings] = await Promise.all([
    prisma.location.findMany({ where: { businessId: business.id }, select: { id: true, name: true, status: true, posProvider: true }, orderBy: { createdAt: "asc" } }),
    prisma.visit.groupBy({ by: ["locationId"], where: { businessId: business.id, occurredAt: { gte: since } }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.customer.groupBy({ by: ["locationId"], where: { businessId: business.id }, _count: { _all: true } }),
    prisma.customer.groupBy({ by: ["locationId"], where: { businessId: business.id, firstSeenAt: { gte: since } }, _count: { _all: true } }),
    prisma.visit.groupBy({ by: ["locationId"], where: { businessId: business.id, ratedAt: { gte: since }, rating: { not: null } }, _avg: { rating: true }, _count: { _all: true } }),
  ]);
  // Repeat rate: customers with 2+ bills in the period, out of those with any.
  const perCustomer = await prisma.visit.groupBy({ by: ["locationId", "customerId"], where: { businessId: business.id, occurredAt: { gte: since } }, _count: { _all: true } });

  const row = (id: string | null) => {
    const mine = (x: { locationId: string }) => !id || x.locationId === id;
    const b = bills.filter(mine), pc = perCustomer.filter(mine), r = ratings.filter(mine);
    const count = b.reduce((t, x) => t + x._count._all, 0);
    const revenue = b.reduce((t, x) => t + (x._sum.amount ?? 0), 0);
    const ratedN = r.reduce((t, x) => t + x._count._all, 0);
    return {
      bills: count, revenue, avg: count ? revenue / count : 0,
      customers: customers.filter(mine).reduce((t, x) => t + x._count._all, 0),
      newCustomers: newCustomers.filter(mine).reduce((t, x) => t + x._count._all, 0),
      repeat: pc.length ? pc.filter((x) => x._count._all > 1).length / pc.length : null,
      rating: ratedN ? r.reduce((t, x) => t + (x._avg.rating ?? 0) * x._count._all, 0) / ratedN : null,
    };
  };
  const fmt = (v: number) => money(s, v);
  const cells = (x: ReturnType<typeof row>) => [
    x.bills, fmt(x.revenue), fmt(x.avg), x.customers, x.newCustomers,
    x.repeat == null ? "—" : `${Math.round(x.repeat * 100)}%`, x.rating == null ? "—" : `${x.rating.toFixed(1)} ★`,
  ];
  const heads = [terms.visits, "Revenue", terms.avgValue, "Customers", "New", "Came again", "Rating"];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outlets</h1>
          <p className="mt-1 text-sm text-gray-600">Last {days} days, each outlet and all together.</p>
        </div>
        <div className="flex gap-2 text-sm">
          {[7, 30, 90].map((d) => (
            <a key={d} href={`/dashboard/outlets?days=${d}`} className={`rounded-full border px-3 py-1.5 ${d === days ? "border-brand-600 bg-brand-50 font-medium" : "border-control hover:bg-gray-50"}`}>{d} days</a>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-card border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr><th className="px-4 py-2 font-medium">Outlet</th>{heads.map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {locations.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2">{l.name}{l.status !== "ACTIVE" && <span className="ml-2 text-xs text-gray-500">(paused)</span>}{l.posProvider && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">POS</span>}</td>
                {cells(row(l.id)).map((c, i) => <td key={i} className="px-4 py-2">{c}</td>)}
              </tr>
            ))}
            {locations.length > 1 && (
              <tr className="bg-gray-50 font-medium">
                <td className="px-4 py-2">All outlets</td>
                {cells(row(null)).map((c, i) => <td key={i} className="px-4 py-2">{c}</td>)}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">&quot;Came again&quot; = customers with 2 or more {terms.visits.toLowerCase()} in the period. A customer is counted at each outlet they visit.</p>
    </div>
  );
}
