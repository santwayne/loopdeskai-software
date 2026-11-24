import { BUNDLE_PLANS, BUNDLE_PLAN_IDS, isBundlePlan, type Currency } from "@/lib/hub/plans";
import type { FrontDeskPlan } from "@/lib/types";

/**
 * The plans a customer can pick (signup and Billing): the built-in plans plus
 * every active bundle from Admin → Products & Bundles that is shown to
 * customers (e.g. Korvo + Loyvexa). Picking one is a request; our team
 * activates it in Admin → Bundles. There is no online payment unless
 * NEXT_PUBLIC_ONLINE_PAYMENTS=true.
 *
 * A plan key is a built-in id ("GROW") or "bundle:<Bundle id>".
 * Pure module (no Prisma) so the rules are unit-tested; the page passes the bundles in.
 */

export const ONLINE_PAYMENTS = process.env.NEXT_PUBLIC_ONLINE_PAYMENTS === "true";

export type CustomerPlan = {
  key: string;
  name: string;
  tagline: string;
  price: Record<Currency, number | null>;
  per: "month" | "year";
  features: string[];
  custom: boolean;
};

export type BundleRow = {
  id: string; name: string; description: string | null; priceInr: number | null; priceCad: number | null; interval: string;
  growthManager: boolean; active: boolean; showToCustomers: boolean;
  items: { product: { name: string; description: string | null; connect: string; active: boolean; sortOrder: number } }[];
};

export const bundleKey = (id: string) => `bundle:${id}`;

/** What a plan key points at, or null when it isn't a valid key. */
export function parsePlanKey(key: string | null | undefined): { builtIn: FrontDeskPlan } | { bundleId: string } | null {
  if (!key) return null;
  if (key.startsWith("bundle:") && key.length > 7 && key.length < 60) return { bundleId: key.slice(7) };
  const up = key.toUpperCase();
  return isBundlePlan(up) ? { builtIn: up } : null;
}

export function bundlePlan(b: BundleRow): CustomerPlan {
  const products = b.items.map((i) => i.product).filter((p) => p.active && p.connect !== "HUB").sort((x, y) => x.sortOrder - y.sortOrder);
  return {
    key: bundleKey(b.id),
    name: b.name,
    tagline: b.description || products.map((p) => p.name).join(" + "),
    price: { INR: b.priceInr, CAD: b.priceCad },
    per: b.interval === "YEARLY" ? "year" : "month",
    features: [...products.map((p) => (p.description ? `${p.name}: ${p.description}` : p.name)), ...(b.growthManager ? ["AI Growth Manager"] : [])],
    custom: true,
  };
}

/** Built-in plans first, then bundles shown to customers. */
export function customerPlans(bundles: BundleRow[]): CustomerPlan[] {
  const builtIn = BUNDLE_PLAN_IDS.map((id): CustomerPlan => {
    const p = BUNDLE_PLANS[id];
    return { key: id, name: p.name, tagline: p.tagline, price: { ...p.price }, per: "month", features: p.features, custom: false };
  });
  return [...builtIn, ...bundles.filter((b) => b.active && b.showToCustomers).map(bundlePlan)];
}

export function planLabel(key: string | null | undefined, plans: Pick<CustomerPlan, "key" | "name">[]): string | null {
  if (!key) return null;
  return plans.find((p) => p.key === key)?.name ?? (key.startsWith("bundle:") ? "A bundle that's no longer offered" : key);
}
