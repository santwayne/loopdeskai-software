import { createHash } from "crypto";

/** Pure parts of the reviews inbox (lib/reviews.ts): sources, dedupe key, fallback reply. */

export const REVIEW_SOURCES = ["ZOMATO", "SWIGGY", "GOOGLE", "OTHER"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];
export const SOURCE_LABEL: Record<ReviewSource, string> = { ZOMATO: "Zomato", SWIGGY: "Swiggy", GOOGLE: "Google", OTHER: "Other" };

export type ReviewInput = {
  source: ReviewSource; externalId?: string | null; reviewerName?: string | null; rating?: number | null;
  text?: string | null; url?: string | null; postedAt?: Date | null; locationId?: string | null;
};

/** Same review twice (re-sent email, pasted again) → same id. */
export function reviewKey(r: Pick<ReviewInput, "externalId" | "reviewerName" | "text" | "rating">) {
  if (r.externalId?.trim()) return r.externalId.trim().slice(0, 120);
  return "h:" + createHash("sha256").update(`${(r.reviewerName ?? "").trim().toLowerCase()}|${r.rating ?? ""}|${(r.text ?? "").trim().toLowerCase()}`).digest("hex").slice(0, 32);
}

/** A reply that never invents offers or facts; used when AI isn't set up or fails. */
export function fallbackReply(r: Pick<ReviewInput, "reviewerName" | "rating">, businessName: string) {
  const name = (r.reviewerName ?? "").trim().split(/\s+/)[0];
  const hi = name ? `Hi ${name}, ` : "";
  if (r.rating != null && r.rating <= 3) {
    return `${hi}we're sorry your experience at ${businessName} wasn't what it should be. Thank you for telling us — we'd like to make it right. Please message us so we can look into it.`;
  }
  return `${hi}thank you so much for the lovely review! The whole ${businessName} team is happy you enjoyed it. See you again soon.`;
}
