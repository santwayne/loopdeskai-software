import { NextRequest, NextResponse } from "next/server";
import { processOffers } from "@/lib/offers";
import { processQueuedConsentRequests } from "@/lib/onboarding";
import { requestDueFeedback } from "@/lib/feedback";
import { sendBirthdayOffers } from "@/lib/birthday";
import { expireLapsedPoints } from "@/lib/loyalty-db";
import { sendMonthlyReports } from "@/lib/monthly-report";
import { flushRegularsSync } from "@/lib/hub/regulars-sync";

// Hourly: offers (expire unanswered approvals at 48h, remind the owner at 24h,
// send approved offers that are due, in contact hours) and queued YES/NO
// consent requests (imports), plus the Restaurant Bundle's rating requests
// (bills 1–3 h old), birthday offers, lapsed points and the 1st-of-month ₹ report. Same CRON_SECRET protection as the other crons.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const offers = await processOffers(now);
  const consent = await processQueuedConsentRequests(now);
  const feedback = await requestDueFeedback(now);
  const birthdays = await sendBirthdayOffers(now);
  const points = await expireLapsedPoints(now);
  const reports = await sendMonthlyReports(now);
  // Loopdesk ⇄ Regulars customer sync catch-up (bug list 28 Nov 2026, A1).
  const regularsSync = await flushRegularsSync().catch(() => null);
  return NextResponse.json({ offers, consent, feedback, birthdays, points, reports, regularsSync });
}

export const GET = handle;
export const POST = handle;
