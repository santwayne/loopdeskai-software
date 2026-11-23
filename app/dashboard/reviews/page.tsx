import { prisma } from "@/lib/prisma";
import { getOwnerBusinessOrRedirect } from "@/lib/session";
import { getSettings } from "@/lib/growth/settings";
import { gmb, type GmbReview } from "@/lib/growth/connectors";
import { ReviewsInbox, type InboxReview } from "@/components/reviews-inbox";

export const dynamic = "force-dynamic";

/** Every review in one place: Google (live from the GMB tool) + Zomato, Swiggy and others. */
export default async function ReviewsPage() {
  const business = await getOwnerBusinessOrRedirect();
  if (!business) return null;
  const s = await getSettings(business);
  const stored = await prisma.review.findMany({ where: { businessId: business.id }, orderBy: { postedAt: "desc" }, take: 200 });
  let google: GmbReview[] = [];
  let googleNote: string | null = null;
  if (gmb.available(s)) {
    try { google = await gmb.unrepliedReviews(s); } catch { googleNote = "Google reviews couldn't be loaded just now."; }
  } else googleNote = "Connect Google Profile to see and answer Google reviews here.";

  const items: InboxReview[] = [
    ...google.map((g) => ({
      id: `g:${g.id}`, googleId: g.id, source: "GOOGLE" as const, reviewerName: g.reviewer_name ?? null, rating: g.star_rating ?? null,
      text: g.comment ?? null, url: null, postedAt: g.posted_at ?? null, replyDraft: g.ai_draft_reply ?? "", status: "NEW",
    })),
    ...stored.map((r) => ({
      id: r.id, googleId: null, source: r.source as InboxReview["source"], reviewerName: r.reviewerName, rating: r.rating,
      text: r.text, url: r.url, postedAt: r.postedAt.toISOString(), replyDraft: r.replyDraft ?? "", status: r.status,
    })),
  ].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Google, Zomato and Swiggy in one list, each with a reply drafted for you. Bad reviews come to your WhatsApp straight away.
          Zomato and Swiggy don&apos;t let other apps post replies, so copy the reply and paste it in their partner app, then mark it replied.
        </p>
        {googleNote && <p className="mt-1 text-sm text-amber-700">{googleNote}</p>}
      </div>
      <ReviewsInbox items={items} />
    </div>
  );
}
