import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerBusiness } from "@/lib/session";
import { REVIEW_SOURCES, addReview } from "@/lib/reviews";
import { gmb } from "@/lib/growth/connectors";
import { getSettings } from "@/lib/growth/settings";

/**
 * Dashboard → Reviews (owner):
 *  POST  { action: "add", source, reviewerName?, rating?, text?, url? }  paste a Zomato/Swiggy review
 *  POST  { action: "google-reply", reviewId, text }                       reply on Google through the GMB tool
 *  PATCH { id, status?: "REPLIED" | "IGNORED" | "NEW", replyDraft? }       a Zomato/Swiggy review was answered there
 */
const post = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), source: z.enum(REVIEW_SOURCES), reviewerName: z.string().trim().max(100).optional(), rating: z.number().int().min(1).max(5).optional(), text: z.string().max(4000).optional(), url: z.string().url().optional() }),
  z.object({ action: z.literal("google-reply"), reviewId: z.string().min(1), text: z.string().trim().min(5).max(4000) }),
]);

export async function POST(req: NextRequest) {
  const business = await getOwnerBusiness();
  if (!business) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const p = post.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
  if (p.data.action === "add") {
    if (p.data.rating == null && !(p.data.text ?? "").trim()) return NextResponse.json({ error: "Add the stars or the review text." }, { status: 400 });
    const { review, created } = await addReview(business, p.data);
    return NextResponse.json({ review, created });
  }
  const s = await getSettings(business);
  if (!gmb.available(s)) return NextResponse.json({ error: "Google Profile isn't connected." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, review: await gmb.reply(s, p.data.reviewId, p.data.text) });
  } catch (err) {
    return NextResponse.json({ error: `Google reply failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}

const patch = z.object({ id: z.string(), status: z.enum(["NEW", "REPLIED", "IGNORED"]).optional(), replyDraft: z.string().max(4000).optional() });

export async function PATCH(req: NextRequest) {
  const business = await getOwnerBusiness();
  if (!business) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const p = patch.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Check the form." }, { status: 400 });
  const r = await prisma.review.updateMany({
    where: { id: p.data.id, businessId: business.id },
    data: { ...(p.data.status ? { status: p.data.status, repliedAt: p.data.status === "REPLIED" ? new Date() : null } : {}), ...(p.data.replyDraft != null ? { replyDraft: p.data.replyDraft } : {}) },
  });
  return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
