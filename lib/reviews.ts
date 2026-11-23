import type { Business } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logger";
import { estimateClaudeCostUsd, recordUsageEvent } from "@/lib/usage";
import { getSettings } from "@/lib/growth/settings";
import { ownerPhoneFor } from "@/lib/growth/brief";
import { ownerWhatsAppSender, sendOwnerWhatsApp } from "@/lib/whatsapp-send";
import { senderName } from "@/lib/sms";
import { SOURCE_LABEL, fallbackReply, reviewKey, type ReviewInput, type ReviewSource } from "@/lib/review-rules";

/**
 * Reviews inbox (Restaurant Bundle phase 3): Zomato, Swiggy, Google and
 * others in one place, each with an AI reply draft; a 1–3 star review
 * alerts the owner on WhatsApp.
 *
 * Zomato and Swiggy have no public API for a restaurant's reviews, so they
 * come in through POST /api/v1/reviews (an email parser, Zapier, or any tool
 * the restaurant uses) or are pasted on Dashboard → Reviews. Their replies are
 * copied and posted in the Zomato / Swiggy partner app. Google reviews are
 * read live from the GMB tool and replied to from the inbox.
 */

export { REVIEW_SOURCES, SOURCE_LABEL, reviewKey, fallbackReply } from "@/lib/review-rules";
export type { ReviewSource, ReviewInput } from "@/lib/review-rules";

export async function draftReply(business: Pick<Business, "id" | "name">, r: ReviewInput): Promise<string> {
  const fallback = fallbackReply(r, business.name);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallback;
  const prompt = [
    `Write the public reply from "${business.name}" (a restaurant/café) to this ${SOURCE_LABEL[r.source]} review.`,
    "Rules: 2–3 sentences, warm and specific to what they wrote, no emojis, no invented discounts, freebies, dates or facts.",
    "For 1–3 stars: apologise, don't argue, invite them to message the restaurant. Reply in the review's language (Hindi/Hinglish/English).",
    "Reply with the text only.",
    "",
    `Reviewer: ${r.reviewerName || "(no name)"} · Stars: ${r.rating ?? "?"} · Review: ${(r.text ?? "(no text)").slice(0, 1500)}`,
  ].join("\n");
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.GROWTH_MODEL || "claude-haiku-4-5-20251001", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = String(data?.content?.[0]?.text ?? "").trim();
    const inTok = data?.usage?.input_tokens ?? 0, outTok = data?.usage?.output_tokens ?? 0;
    await recordUsageEvent({ businessId: business.id, type: "AI_SCRIPT_PERSONALIZATION", inputTokens: inTok, outputTokens: outTok, estimatedCostUsd: estimateClaudeCostUsd(inTok, outTok) });
    return text.length >= 20 && text.length <= 1000 ? text : fallback;
  } catch (err) {
    await logEvent({ businessId: business.id, source: "API", level: "WARN", message: "Review reply draft fell back to the template", meta: { error: String(err) } });
    return fallback;
  }
}

/** Store a review once, draft a reply, alert the owner for 1–3 stars. */
export async function addReview(business: Business, input: ReviewInput) {
  const externalId = reviewKey(input);
  const existing = await prisma.review.findUnique({ where: { businessId_source_externalId: { businessId: business.id, source: input.source, externalId } } });
  if (existing) return { review: existing, created: false };
  const review = await prisma.review.create({
    data: {
      businessId: business.id, locationId: input.locationId ?? null, source: input.source, externalId,
      reviewerName: input.reviewerName?.slice(0, 100) ?? null, rating: input.rating ?? null, text: input.text?.slice(0, 4000) ?? null,
      url: input.url ?? null, postedAt: input.postedAt ?? new Date(), replyDraft: await draftReply(business, input),
    },
  });
  if (review.rating != null && review.rating <= 3) {
    const full = await prisma.business.findUniqueOrThrow({ where: { id: business.id }, include: { locations: true } });
    const s = await getSettings(full);
    const to = ownerPhoneFor(s, full);
    const loc = full.locations.find((l) => l.id === review.locationId) ?? full.locations[0];
    if (to && ownerWhatsAppSender(loc, full)) {
      const ok = await sendOwnerWhatsApp(full, loc, to, {
        templateKey: "owner_new_message",
        params: [senderName(loc, full), `${review.reviewerName ?? "A customer"} on ${SOURCE_LABEL[review.source as ReviewSource]}`, `${review.rating}★ review: ${(review.text ?? "").replace(/\s+/g, " ").slice(0, 300)} — a reply is drafted in Loopdesk → Reviews.`],
      }).catch(() => false);
      if (ok) await prisma.review.update({ where: { id: review.id }, data: { ownerAlerted: true } });
    }
  }
  return { review, created: true };
}
