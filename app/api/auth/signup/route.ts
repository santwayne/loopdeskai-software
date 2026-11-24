import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { allow, clientIp } from "@/lib/rate-limit";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";
import { createBundleOwner, OnboardingError } from "@/lib/new-owner";
import type { FrontDeskPlan } from "@/lib/types";
import { SECTORS } from "@/lib/types";
import { BUNDLE_PLAN_IDS } from "@/lib/hub/plans";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logger";
import { parsePlanKey } from "@/lib/hub/customer-plans";

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  businessName: z.string().min(1),
  sector: z.enum(SECTORS as [string, ...string[]]),
  // Every Loopdesk signup picks a plan: a built-in one, or "bundle:<id>" from
  // Products & Bundles (Korvo, Loyvexa…). Our team activates it — no online payment.
  plan: z.string().max(60).optional(),
  bundlePlan: z.enum(BUNDLE_PLAN_IDS as [string, ...string[]]).optional(),
  country: z.enum(["CA", "IN"]).optional(),
  phone: z.string().max(30).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, password, businessName, sector, country, phone } = parsed.data;
  const email = parsed.data.email;
  const picked = parsePlanKey(parsed.data.plan ?? parsed.data.bundlePlan ?? "GROW");
  if (!picked) return NextResponse.json({ error: "Choose a plan." }, { status: 400 });
  let customBundleId: string | null = null;
  if ("bundleId" in picked) {
    const bundle = await prisma.bundle.findFirst({ where: { id: picked.bundleId, active: true, showToCustomers: true }, select: { id: true } });
    if (!bundle) return NextResponse.json({ error: "That plan isn't available any more. Choose another one." }, { status: 400 });
    customBundleId = bundle.id;
  }
  const planRequest = "bundleId" in picked ? `bundle:${picked.bundleId}` : picked.builtIn;
  if (!(await allow(`signup:ip:${clientIp(req)}`, 10, 60 * 60_000))) return NextResponse.json({ error: "Too many signups from this connection. Try again later." }, { status: 429 });

  let user;
  try {
    user = await createBundleOwner({
      name, email, password, businessName, sector, country, phone,
      bundlePlan: "builtIn" in picked ? (picked.builtIn as FrontDeskPlan) : null, customBundleId, planRequest,
    });
  } catch (e) {
    if (e instanceof OnboardingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  await logEvent({ businessId: user.businesses[0]?.id, source: "BILLING", level: "INFO", message: `New signup asked for plan ${planRequest}: activate it in Admin → Bundles` });
  const token = await createSessionToken({ userId: user.id, email: user.email });
  const res = NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email },
    next: "/dashboard/billing",
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
