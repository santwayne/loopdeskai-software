import { prisma } from "@/lib/prisma";
import { getCurrentMember } from "@/lib/session";
import { CounterDesk } from "@/components/counter-desk";

export const dynamic = "force-dynamic";

/** Counter: record a bill by phone number, and use points / wallet with a WhatsApp code. */
export default async function CounterPage() {
  const member = await getCurrentMember();
  if (!member) return null;
  const { business } = member;
  const locations = await prisma.location.findMany({ where: { businessId: business.id }, select: { id: true, name: true, posProvider: true }, orderBy: { createdAt: "asc" } });
  const withPos = locations.filter((l) => l.posProvider).map((l) => l.name);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Counter</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Type the customer&apos;s mobile and the bill so they get points and the rating message.
          {withPos.length > 0 && <> Bills at {withPos.join(", ")} come in from the POS by themselves — use this screen there only to use points or wallet money.</>}
        </p>
      </div>
      <CounterDesk locations={locations.map(({ id, name }) => ({ id, name }))} loyalty={business.loyaltyEnabled} currency={business.country === "IN" ? "INR" : "CAD"} />
    </div>
  );
}
