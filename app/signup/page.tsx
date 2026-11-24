import Link from "next/link";
import { BUNDLE_NAME } from "@/lib/brand";
import { BundleSignupForm } from "@/components/forms/bundle-signup-form";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ONLINE_PAYMENTS, bundleKey, customerPlans, parsePlanKey } from "@/lib/hub/customer-plans";

export const dynamic = "force-dynamic";

// /signup[?plan=GROW | ?plan=bundle:<id> | ?bundle=<id>][&country=CA]
// The same signup the website's "Start free trial" and pricing buttons open.
// Lists the built-in plans and the bundles shown to customers (Korvo, Loyvexa…).
export default async function SignupPage({ searchParams }: { searchParams: { plan?: string; bundle?: string; country?: string } }) {
  const [signedIn, bundles] = await Promise.all([
    getCurrentUser(),
    prisma.bundle.findMany({
      where: { active: true, showToCustomers: true }, orderBy: { name: "asc" },
      include: { items: { include: { product: { select: { name: true, description: true, connect: true, active: true, sortOrder: true } } } } },
    }),
  ]);
  const plans = customerPlans(bundles);
  const asked = searchParams.bundle ? bundleKey(searchParams.bundle) : searchParams.plan;
  const parsed = parsePlanKey(asked);
  const initial = parsed && plans.some((p) => p.key === ("bundleId" in parsed ? bundleKey(parsed.bundleId) : parsed.builtIn))
    ? ("bundleId" in parsed ? bundleKey(parsed.bundleId) : parsed.builtIn)
    : "GROW";
  return (
    <main className="flex flex-col items-center px-6 pb-16 pt-10">
      {signedIn && (
        <div role="alert" className="mb-6 w-full max-w-2xl rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You&apos;re signed in as {signedIn.email}. Creating an account here signs you out of that one and into the new business.
        </div>
      )}
      <h1 className="mb-1 text-center text-2xl font-semibold">Start with {BUNDLE_NAME}</h1>
      <p className="mb-8 max-w-xl text-center text-sm text-gray-500">
        Pick a plan and create your account. {ONLINE_PAYMENTS ? "Pay on the next screen." : "Our team calls you, sets everything up and activates your plan. No card needed."}
      </p>
      <BundleSignupForm plans={plans} initialPlan={initial} initialCountry={searchParams.country?.toUpperCase() === "CA" ? "CA" : "IN"} onlinePayments={ONLINE_PAYMENTS} />
      <p className="mt-6 text-sm text-gray-500">
        Already have an account? <Link href="/login" className="font-medium text-brand-700">Log in</Link>
      </p>
    </main>
  );
}
