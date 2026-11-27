import type { Business } from "@prisma/client";

/** Plain-words notes under "Bill recorded" (Dashboard → Counter, testing bugs 4 + 5). */
export function counterNotes(
  b: Pick<Business, "loyaltyEnabled" | "pointsPer100" | "autoFeedback" | "autoReviewRequest">,
  bill: { amount: number; pointsAwarded: boolean },
): string[] {
  const notes: string[] = [];
  if (!b.loyaltyEnabled) notes.push("No points: loyalty is switched off. Turn it on in Settings → Loyalty.");
  else if (b.pointsPer100 <= 0) notes.push("No points: points per ₹100 is 0 in Settings → Loyalty.");
  else if (bill.amount < 100) notes.push("No points: points start from a ₹100 bill.");
  else if (!bill.pointsAwarded) notes.push("Points could not be added for this bill. It is in Admin → Logs; please tell support.");
  if (b.autoFeedback) notes.push("The 1–5 rating request goes to the customer on WhatsApp 1–3 hours after the bill, in contact hours.");
  else if (b.autoReviewRequest) notes.push("The Google review request has been sent.");
  else notes.push("No rating request: the rating loop is off in Settings.");
  return notes;
}
