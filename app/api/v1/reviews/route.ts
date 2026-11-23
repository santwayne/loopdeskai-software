import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiKey } from "@/lib/api-keys";
import { REVIEW_SOURCES, addReview } from "@/lib/reviews";

/**
 * POST /api/v1/reviews — reviews from Zomato, Swiggy or any other site, for
 * an email parser, Zapier or the restaurant's own tool (Restaurant Bundle).
 * Auth: Authorization: Bearer rk_live_… (Admin → API keys)
 * Body: { "reviews": [ { "source": "ZOMATO", "externalId": "z-88123", "reviewerName": "Simran",
 *         "rating": 2, "text": "Cold fries", "url": "https://…", "postedAt": "2026-11-23T20:10:00+05:30" } ] }
 * Safe to resend: a review is stored once (externalId, or name+stars+text).
 */
const review = z.object({
  source: z.enum(REVIEW_SOURCES),
  externalId: z.string().trim().max(120).optional(),
  reviewerName: z.string().trim().max(100).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  text: z.string().max(4000).optional(),
  url: z.string().url().optional(),
  postedAt: z.string().datetime({ offset: true }).optional(),
  locationId: z.string().optional(),
}).refine((r) => r.rating != null || (r.text ?? "").trim().length > 0, "a review needs a rating or text");

export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 });
  if (auth.suspended) return NextResponse.json({ error: "Business is suspended" }, { status: 403 });
  const parsed = z.object({ reviews: z.array(z.unknown()).min(1).max(50) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body must be { reviews: [...] } with 1–50 reviews" }, { status: 400 });
  const results = [];
  for (const [index, raw] of parsed.data.reviews.entries()) {
    const r = review.safeParse(raw);
    if (!r.success) { results.push({ index, status: "rejected", error: r.error.issues[0]?.message }); continue; }
    if (r.data.locationId && !auth.business.locations.some((l) => l.id === r.data.locationId)) { results.push({ index, status: "rejected", error: "locationId is not one of this business's outlets" }); continue; }
    const { review: saved, created } = await addReview(auth.business, { ...r.data, postedAt: r.data.postedAt ? new Date(r.data.postedAt) : null });
    results.push({ index, status: created ? "created" : "duplicate", id: saved.id });
  }
  return NextResponse.json({ results });
}
