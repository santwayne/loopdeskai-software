import { prisma } from "@/lib/prisma";
import { BusinessAdminTable } from "@/components/admin/business-admin-table";
import { NewClientForm } from "@/components/admin/new-client-form";

export const dynamic = "force-dynamic";

export default async function AdminBusinessesPage() {
  const customBundles = await prisma.bundle.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const businesses = await prisma.business.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      owner: { select: { name: true, email: true } },
      _count: { select: { customers: true, callLogs: true, locations: true } },
      locations: { select: { whatsappPhoneNumberId: true } },
    },
  });

  // Messages sent this calendar month (UTC), for the allowance column.
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const usage = await prisma.usageEvent.groupBy({
    by: ["businessId", "type"], where: { type: { in: ["WHATSAPP_SENT", "SMS_SENT"] }, createdAt: { gte: monthStart } },
    _count: { _all: true }, _sum: { smsSegments: true },
  });
  const used = (id: string, type: string) => usage.find((u) => u.businessId === id && u.type === type);

  const rows = businesses.map((b) => ({
    ...b,
    connectedLocations: b.locations.filter((l) => l.whatsappPhoneNumberId).length,
    messagesUsed: { whatsapp: used(b.id, "WHATSAPP_SENT")?._count._all ?? 0, sms: used(b.id, "SMS_SENT")?._sum.smsSegments ?? 0 },
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-gray-500">
          Clients with a bundle. Suspend a client, set how many WhatsApp and SMS messages it gets each month, or tune its follow-ups here; change the bundle in Bundles or Products &amp; Bundles.
        </p>
      </div>
      <NewClientForm customBundles={customBundles} />
      <BusinessAdminTable businesses={rows} showPlan={false} />
    </div>
  );
}
