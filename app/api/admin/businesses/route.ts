import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/admin";
import { logEvent } from "@/lib/logger";
import { SECTORS, type FrontDeskPlan } from "@/lib/types";
import { BUNDLE_PLAN_IDS } from "@/lib/hub/plans";
import { activateBundle } from "@/lib/hub/bundle";
import { activateCustomBundle } from "@/lib/hub/catalog";
import { createBundleOwner, OnboardingError } from "@/lib/new-owner";

export async function GET() {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const businesses = await prisma.business.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { customers: true, callLogs: true, locations: true } },
      locations: { select: { whatsappPhoneNumberId: true } },
    },
  });

  const rows = businesses.map((b) => ({
    ...b,
    connectedLocations: b.locations.filter((l) => l.whatsappPhoneNumberId).length,
  }));

  return NextResponse.json({ businesses: rows });
}

/**
 * Admin → Clients → New client (H3): makes the owner login and the business
 * exactly like /signup, and can give it a bundle straight away (a demo, a
 * pilot or an offline sale). Leave the password blank to get a random one,
 * shown once here so it can be handed to the client.
 */
const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(200).optional().or(z.literal("")),
  businessName: z.string().trim().min(1).max(160),
  sector: z.enum(SECTORS as [string, ...string[]]),
  country: z.enum(["CA", "IN"]).default("IN"),
  phone: z.string().max(30).optional(),
  /** A built-in plan id (ANSWER…), "custom:<bundleId>", or "" to leave it waiting for payment. */
  bundle: z.string().max(80).default(""),
  days: z.number().int().min(1).max(366).optional(),
  note: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const admin = await requireSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  const custom = b.bundle.startsWith("custom:") ? b.bundle.slice(7) : null;
  const builtIn = !custom && (BUNDLE_PLAN_IDS as string[]).includes(b.bundle) ? (b.bundle as FrontDeskPlan) : null;
  if (b.bundle && !custom && !builtIn) return NextResponse.json({ error: "Unknown bundle" }, { status: 400 });
  if (custom && !(await prisma.bundle.findUnique({ where: { id: custom }, select: { id: true } }))) {
    return NextResponse.json({ error: "Bundle not found" }, { status: 404 });
  }

  const generated = !b.password;
  const password = b.password || randomBytes(9).toString("base64url");
  let user;
  try {
    user = await createBundleOwner({
      name: b.name, email: b.email, password, businessName: b.businessName, sector: b.sector,
      bundlePlan: builtIn ?? "ANSWER", country: b.country, phone: b.phone,
    });
  } catch (e) {
    if (e instanceof OnboardingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const business = user.businesses[0];
  await logEvent({ businessId: business.id, source: "BILLING", level: "INFO", message: `Admin ${admin.email} created this client`, meta: { bundle: b.bundle || null } });

  const reason = `admin ${admin.email}${b.note ? `: ${b.note}` : ""} (new client)`;
  let activation: unknown = null;
  if (custom) activation = await activateCustomBundle(business.id, custom, { days: b.days, reason });
  else if (builtIn) activation = await activateBundle(business.id, builtIn, { days: b.days ?? 30, reason });

  return NextResponse.json({
    business: { id: business.id, name: business.name },
    owner: { email: user.email },
    // Shown once to the admin; never stored in plain text.
    password: generated ? password : undefined,
    activation,
  }, { status: 201 });
}
