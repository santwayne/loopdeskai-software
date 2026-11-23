import { prisma } from "@/lib/prisma";
import { getCurrentMember } from "@/lib/session";
import { CounterDesk } from "@/components/counter-desk";
import { getSettings } from "@/lib/growth/settings";
import { reservationLine } from "@/lib/restaurant";

export const dynamic = "force-dynamic";

/** Counter: record a bill by phone number, and use points / wallet with a WhatsApp code. */
export default async function CounterPage() {
  const member = await getCurrentMember();
  if (!member) return null;
  const { business } = member;
  const locations = await prisma.location.findMany({ where: { businessId: business.id }, select: { id: true, name: true, posProvider: true }, orderBy: { createdAt: "asc" } });
  const withPos = locations.filter((l) => l.posProvider).map((l) => l.name);
  const s = await getSettings(business);
  const now = Date.now();
  const upcoming = await prisma.reservation.findMany({
    where: { businessId: business.id, status: "BOOKED", at: { gte: new Date(now - 2 * 60 * 60 * 1000), lte: new Date(now + 2 * 24 * 60 * 60 * 1000) } },
    orderBy: { at: "asc" }, take: 50,
  });
  const names = new Map((await prisma.customer.findMany({ where: { id: { in: upcoming.map((r) => r.customerId) } }, select: { id: true, name: true, phone: true } })).map((c) => [c.id, c]));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Counter</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Type the customer&apos;s mobile and the bill so they get points and the rating message.
          {withPos.length > 0 && <> Bills at {withPos.join(", ")} come in from the POS by themselves — use this screen there only to use points or wallet money.</>}
        </p>
      </div>
      {upcoming.length > 0 && (
        <section className="rounded-card border border-gray-200 bg-white p-4 text-sm">
          <h2 className="mb-2 font-medium">Bookings and takeaway, next 2 days</h2>
          <ul className="divide-y divide-gray-100">
            {upcoming.map((r) => {
              const c = names.get(r.customerId);
              return (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{c?.name ?? "Customer"} <span className="text-gray-500">+{c?.phone}</span></span>
                  <span>{reservationLine({ kind: r.kind as "TABLE" | "TAKEAWAY", partySize: r.partySize, at: r.at, items: r.items }, s.timezone)}{r.notes ? ` · ${r.notes}` : ""}{!r.confirmedAt && <span className="ml-2 text-amber-700">(WhatsApp confirmation not sent)</span>}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <CounterDesk locations={locations.map(({ id, name }) => ({ id, name }))} loyalty={business.loyaltyEnabled} currency={business.country === "IN" ? "INR" : "CAD"} />
    </div>
  );
}
