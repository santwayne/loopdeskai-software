import type { FrontDeskPlan } from "@/lib/types";
import { FRONT_DESK_SMS_LIMIT } from "@/lib/types";
import { TOOL_NAMES } from "@/lib/brand";

/**
 * Bundle A as one product: one signup, one bill, one login.
 *
 * Loopdesk AI is the hub. Each plan switches on a set of tools; the hub creates
 * the business's account in each of them (lib/hub/provision.ts) and signs the
 * owner in with one click (app/api/hub/open/[tool]). Regulars is one of those
 * tools since Nov 2026, like Korvo and Loyvexa (its own app and database).
 *
 * Prices: CAD are the published Front Desk prices. INR are a DRAFT — confirm
 * before taking Indian payments.
 */
export type Tool = "REGULARS" | "WAYNERING" | "FIELD_SERVICE" | "GMB" | "VIDEO" | "KORVO" | "LOYVEXA";
// Order matters: set-up runs in this order, and Loyvexa needs the Korvo
// company code, so KORVO comes before LOYVEXA (fault H5).
export const TOOLS: Tool[] = ["REGULARS", "WAYNERING", "FIELD_SERVICE", "GMB", "VIDEO", "KORVO", "LOYVEXA"];
export type Currency = "CAD" | "INR";

export type BundlePlan = {
  id: FrontDeskPlan;
  name: string;
  tagline: string;
  price: Record<Currency, number>;
  tools: Tool[];
  growthManager: boolean;
  features: string[];
};

export const BUNDLE_PLANS: Record<FrontDeskPlan, BundlePlan> = {
  ANSWER: {
    id: "ANSWER", name: "Answer", tagline: "Never miss a call",
    price: { CAD: 149, INR: 4999 }, tools: ["WAYNERING"], growthManager: false,
    features: ["AI receptionist answers every call, 24/7", "Text summary to you after every call", "Shared customer inbox"],
  },
  ANSWER_RETURN: {
    id: "ANSWER_RETURN", name: "Answer + Return", tagline: "Turn calls into repeat customers",
    price: { CAD: 249, INR: 7999 }, tools: ["WAYNERING"], growthManager: true,
    features: ["Everything in Answer", "Missed-call text-back, review requests, win-backs", `${TOOL_NAMES.growth} with a morning plan`],
  },
  GROW: {
    id: "GROW", name: "Grow", tagline: "The whole growth team",
    price: { CAD: 549, INR: 17999 }, tools: ["WAYNERING", "FIELD_SERVICE", "GMB", "VIDEO"], growthManager: true,
    features: ["Everything in Answer + Return", `${TOOL_NAMES.jobs}: quotes, jobs, invoices`, `${TOOL_NAMES.google}: review replies and posts`, `Promo reels from ${TOOL_NAMES.ads}`],
  },
};

export const BUNDLE_PLAN_IDS = Object.keys(BUNDLE_PLANS) as FrontDeskPlan[];
export const GRACE_DAYS = 3;
export const PERIOD_DAYS = 30;

export const TOOL_META: Record<Tool, {
  name: string;
  /** What the owner gets there, for the home screen. */
  blurb: string;
  /** Owner can sign in to it with one click from the home screen. */
  ownerLogin: boolean;
  apiEnv: string;
  appEnv?: string;
  secretEnv: string;
  /** Pages the owner may be sent to after single sign-on. */
  pages?: Record<string, string>;
}> = {
  // Customer loyalty on WhatsApp (regulars.wayneesolutions.com). A tool like
  // any other since Nov 2026: only bundles that include it get an account,
  // and the owner opens it with one click (Regulars /sso). Needs
  // HUB_SECRET there = HUB_SECRET_REGULARS here.
  REGULARS: {
    name: "Regulars", blurb: "Customer loyalty: offers, win-backs and WhatsApp follow-ups", ownerLogin: true,
    apiEnv: "REGULARS_API_URL", appEnv: "REGULARS_APP_URL", secretEnv: "HUB_SECRET_REGULARS",
    pages: { home: "/dashboard", offers: "/dashboard/offers", customers: "/dashboard/customers" },
  },
  WAYNERING: {
    name: TOOL_NAMES.calls, blurb: "Calls, recordings and your AI receptionist", ownerLogin: true,
    apiEnv: "WAYNERING_API_URL", appEnv: "WAYNERING_APP_URL", secretEnv: "HUB_SECRET_WAYNERING",
    pages: { home: "/portal", calls: "/portal/inbound/calls", receptionist: "/portal/inbound/receptionist", numbers: "/portal/inbound/numbers" },
  },
  FIELD_SERVICE: {
    name: TOOL_NAMES.jobs, blurb: "Quotes, jobs, technicians and invoices", ownerLogin: true,
    apiEnv: "FIELD_SERVICE_API_URL", appEnv: "FIELD_SERVICE_APP_URL", secretEnv: "HUB_SECRET_FIELD_SERVICE",
    pages: { home: "/admin/dashboard" },
  },
  GMB: {
    name: TOOL_NAMES.google, blurb: "Reviews and posts on your Google listing", ownerLogin: true,
    apiEnv: "GMB_API_URL", appEnv: "GMB_APP_URL", secretEnv: "HUB_SECRET_GMB",
    pages: { home: "/", reviews: "/reviews" },
  },
  VIDEO: {
    name: TOOL_NAMES.ads, blurb: "Finished video ads and social posts", ownerLogin: true,
    apiEnv: "VIDEO_STUDIO_API_URL", appEnv: "VIDEO_STUDIO_APP_URL", secretEnv: "HUB_SECRET_VIDEO",
    pages: { home: "/ads", make: "/ads/new" },
  },
  // Distributor software with Tally (Growlane AI). Set up by the hub since
  // Nov 2026: company + owner admin, paused when the bundle lapses, and one
  // click from the hub signs the owner in (Korvo web app /sso). Korvo keeps
  // its own HUB_SECRET for the Loyvexa link, so its hub secret there is
  // LOOPDESK_HUB_SECRET (= HUB_SECRET_KORVO here).
  KORVO: {
    name: "Korvo", blurb: "Distributor app: dealers, orders, approvals, Tally", ownerLogin: true,
    apiEnv: "KORVO_API_URL", appEnv: "KORVO_APP_URL", secretEnv: "HUB_SECRET_KORVO",
    pages: { home: "/" },
  },
  // Dealer / channel loyalty for manufacturers (Growlane AI). Not in the
  // built-in Front Desk plans; sold through custom bundles (Products & Bundles).
  // The hub creates the brand (Loyvexa "tenant") and its first admin, pauses
  // it when the bundle lapses, and signs the owner into the brand console.
  LOYVEXA: {
    name: "Loyvexa", blurb: "Dealer and mechanic loyalty: QR points, schemes, UPI payouts", ownerLogin: true,
    apiEnv: "LOYVEXA_API_URL", appEnv: "LOYVEXA_APP_URL", secretEnv: "HUB_SECRET_LOYVEXA",
    pages: { home: "/admin/" },
  },
};

export const currencyFor = (country: string): Currency => (country === "IN" ? "INR" : "CAD");
export const isBundlePlan = (p: string | null | undefined): p is FrontDeskPlan => !!p && p in BUNDLE_PLANS;
export const planTools = (p: string | null | undefined): Tool[] => (isBundlePlan(p) ? BUNDLE_PLANS[p].tools : []);
export const smsLimitFor = (p: FrontDeskPlan) => FRONT_DESK_SMS_LIMIT[p];

export function formatPrice(amount: number, currency: Currency) {
  return currency === "INR" ? `₹${amount.toLocaleString("en-IN")}` : `C$${amount}`;
}

/** Tools are reachable while paid, plus a short grace after the paid period ends. */
export function bundleLive(b: { bundleStatus: string; bundlePaidUntil: Date | null }, now = new Date()) {
  if (b.bundleStatus !== "ACTIVE" || !b.bundlePaidUntil) return false;
  return b.bundlePaidUntil.getTime() + GRACE_DAYS * 86400000 > now.getTime();
}
