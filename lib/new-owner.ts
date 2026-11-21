import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { isPlaceholderPhone, normalizePhone, toE164 } from "@/lib/phone";
import type { FrontDeskPlan } from "@/lib/types";

export type NewOwnerInput = {
  name: string;
  email: string;
  password: string;
  businessName: string;
  sector: string;
  /** Built-in plan picked at signup. A custom bundle given by an admin replaces it. */
  bundlePlan: FrontDeskPlan;
  country?: "CA" | "IN";
  phone?: string;
};

export class OnboardingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * One owner login + one Loopdesk business waiting for payment. Used by the
 * public /signup and by Admin → Clients → "New client" (H3), so both make
 * exactly the same account.
 */
export async function createBundleOwner(input: NewOwnerInput) {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findFirst({ where: { email: { in: [email, input.email] } } });
  if (existing) throw new OnboardingError(409, "Email already registered");

  const country = input.country ?? "IN";
  const digits = input.phone?.trim() ? normalizePhone(input.phone, country) : null;
  if (input.phone?.trim() && (!digits || isPlaceholderPhone(digits))) {
    throw new OnboardingError(400, "That mobile number doesn't look right. Use your real mobile — your morning plan is sent to it.");
  }
  const ownerPhone = digits ? toE164(digits) : null;
  const india = country === "IN";

  return prisma.user.create({
    data: {
      name: input.name,
      email,
      passwordHash: await hashPassword(input.password),
      businesses: {
        create: {
          name: input.businessName,
          sector: input.sector,
          // Every business needs at least one Location to connect WhatsApp
          // to (see Location model) — auto-create one named after the
          // business itself so a single-outlet signup needs no extra step.
          // Multi-location chains add more from Settings.
          locations: { create: { name: input.businessName } },
          country,
          defaultChannel: india ? "WHATSAPP" : "SMS",
          frontDeskPlan: input.bundlePlan,
          bundleStatus: "PENDING_PAYMENT",
          growthSettings: {
            create: {
              ownerPhone,
              timezone: india ? "Asia/Kolkata" : "America/Toronto",
              currency: india ? "INR" : "CAD",
              avgJobValue: india ? 1500 : 250,
              messageLanguage: india ? "hinglish" : "en",
              callQuoteAbove: india ? 20000 : 500,
            },
          },
        },
      },
    },
    include: { businesses: true },
  });
}
