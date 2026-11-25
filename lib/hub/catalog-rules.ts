import { TOOLS, planTools, type Tool } from "@/lib/hub/plans";

/**
 * Products & Bundles: the rules, with no database access (unit-tested in
 * test/catalog.test.ts). lib/hub/catalog.ts does the reads and writes.
 */

export type Connect = "HUB" | "AUTO" | "MANUAL";
export const CONNECTS: Connect[] = ["HUB", "AUTO", "MANUAL"];

export type CatalogProduct = {
  key: string; name: string; description: string; url: string | null;
  connect: Connect; hubTool: Tool | null; sortOrder: number;
};

/**
 * Software that exists in code already. Created in the catalog the first
 * time the page opens; their name/price/description can be edited, but not
 * how they connect (that is code).
 */
export const BUILT_IN_PRODUCTS: CatalogProduct[] = [
  // Regulars was the "HUB" product every bundle had to include. Since Nov 2026
  // Loopdesk is the hub and Regulars is an optional tool; ensureCatalog()
  // switches the existing row over and re-syncs its bundles.
  { key: "regulars", name: "Regulars", description: "Customer loyalty: offers, win-backs and WhatsApp follow-ups", url: null, connect: "AUTO", hubTool: "REGULARS", sortOrder: 0 },
  { key: "waynering", name: "WayneRing", description: "AI receptionist: answers calls, books, texts back missed calls", url: null, connect: "AUTO", hubTool: "WAYNERING", sortOrder: 10 },
  { key: "field-service", name: "Jobs (CRM)", description: "Quotes, jobs, technicians and invoices", url: null, connect: "AUTO", hubTool: "FIELD_SERVICE", sortOrder: 20 },
  { key: "gmb", name: "GMB Manager", description: "Google reviews and posts", url: null, connect: "AUTO", hubTool: "GMB", sortOrder: 30 },
  { key: "video", name: "AI Video Studio", description: "Video ads and social posts", url: null, connect: "AUTO", hubTool: "VIDEO", sortOrder: 40 },
  // Korvo and Loyvexa were MANUAL starter products; ensureCatalog() switches
  // the existing rows over (Korvo: 21 Nov 2026, H4).
  { key: "korvo", name: "Korvo", description: "Distributor software: sales hierarchy, orders, Tally", url: null, connect: "AUTO", hubTool: "KORVO", sortOrder: 60 },
  { key: "loyvexa", name: "Loyvexa", description: "Dealer and channel loyalty: points, schemes, rewards", url: null, connect: "AUTO", hubTool: "LOYVEXA", sortOrder: 70 },
];

/**
 * Our other products, added once as MANUAL (our team sets the client up and
 * the client opens them by link) until they get automatic set-up. Only
 * created if missing; after that they're ordinary catalog rows.
 */
export const STARTER_PRODUCTS: CatalogProduct[] = [];

export const isTool = (t: unknown): t is Tool => typeof t === "string" && (TOOLS as string[]).includes(t);

/** Connected tools in a set of products: AUTO ones only, in the standard order. */
export function toolsFromProducts(products: { connect: string; hubTool: string | null; active?: boolean }[]): Tool[] {
  const set = new Set(products.filter((p) => p.connect === "AUTO" && p.active !== false && isTool(p.hubTool)).map((p) => p.hubTool as Tool));
  return TOOLS.filter((t) => set.has(t));
}

export const encodeTools = (tools: Tool[]) => tools.join(",");
export const decodeTools = (s: string | null | undefined): Tool[] => {
  const set = new Set((s ?? "").split(",").filter(isTool));
  return TOOLS.filter((t) => set.has(t));
};

/** The connected tools a business gets: its custom bundle if it has one, else its built-in plan. */
export function businessTools(b: { customBundleId: string | null; bundleTools: string; frontDeskPlan: string | null }): Tool[] {
  return b.customBundleId ? decodeTools(b.bundleTools) : planTools(b.frontDeskPlan);
}

/**
 * Distributor/dealer software (Korvo, Loyvexa) only makes sense for
 * businesses that sell through dealers. A spa, salon, gym, clinic, restaurant
 * or home-services owner never sees their tiles, even if a bundle includes
 * them (Nov 2026: "Spa ke bundle mein Loyvexa/Korvo na dikhe").
 */
export const DEALER_TOOLS: Tool[] = ["KORVO", "LOYVEXA"];
export const DEALER_PRODUCT_KEYS = ["korvo", "loyvexa"];
const DEALER_SECTORS = new Set(["MANUFACTURER", "RETAIL", "OTHER"]);

export function sectorShowsDealerTools(sector: string | null | undefined) {
  return DEALER_SECTORS.has((sector ?? "").toUpperCase());
}

/** The tools whose tiles a business of this sector sees on its home page. */
export function toolsForSector(tools: Tool[], sector: string | null | undefined): Tool[] {
  return sectorShowsDealerTools(sector) ? tools : tools.filter((t) => !DEALER_TOOLS.includes(t));
}

/** Same rule for catalog products (by key), e.g. manual set-ups. */
export function productFitsSector(productKey: string, sector: string | null | undefined) {
  return sectorShowsDealerTools(sector) || !DEALER_PRODUCT_KEYS.includes(productKey);
}

/**
 * Pages that came from Regulars when Loopdesk was split off it (customers,
 * offers, loyalty counter, restaurant report/reviews/outlets, QR join,
 * calling scripts). Step 1 of making Regulars a separate tool (Nov 2026):
 * they stay in Loopdesk, but only for clients whose bundle includes
 * Regulars. Inbox, Growth Manager, Team, Billing and Settings (with the
 * WhatsApp number every tool sends through) are Loopdesk's own and stay for all.
 */
export const REGULARS_PAGES = [
  "/dashboard/customers", "/dashboard/offers", "/dashboard/counter", "/dashboard/report",
  "/dashboard/reviews", "/dashboard/outlets", "/dashboard/qr", "/dashboard/calling-scripts",
];

export function isRegularsPage(path: string | null | undefined): boolean {
  if (!path) return false;
  return REGULARS_PAGES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Who sees the Regulars pages: built-in plans (Answer / Answer + Return /
 * Grow) and clients with no bundle keep them as before; a custom bundle only
 * if Regulars is ticked in it.
 */
export function showsRegularsPages(b: { customBundleId: string | null }, bundleHasRegulars: boolean): boolean {
  return !b.customBundleId || bundleHasRegulars;
}

/** Days one payment covers. */
export const periodDays = (interval: string) => (interval === "YEARLY" ? 365 : 30);

/** A readable price line: "₹14,999 / month · C$499 / month". */
export function priceLine(p: { priceInr: number | null; priceCad: number | null; interval?: string }): string {
  const per = p.interval === "YEARLY" ? "year" : "month";
  const parts = [
    p.priceInr != null ? `₹${p.priceInr.toLocaleString("en-IN")} / ${per}` : null,
    p.priceCad != null ? `C$${p.priceCad} / ${per}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No price set";
}

/** Slug for a new product key: "Order Desk" → "order-desk". */
export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "product";
}

/** Sum of the products' own prices, to suggest a bundle price. */
export function suggestedPrice(products: { priceInr: number | null; priceCad: number | null }[]) {
  const sum = (k: "priceInr" | "priceCad") => (products.some((p) => p[k] != null) ? products.reduce((t, p) => t + (p[k] ?? 0), 0) : null);
  return { priceInr: sum("priceInr"), priceCad: sum("priceCad") };
}
