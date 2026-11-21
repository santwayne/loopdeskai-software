import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { allow, clientIp } from "@/lib/rate-limit";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";
import { createBundleOwner, OnboardingError } from "@/lib/new-owner";
import type { FrontDeskPlan } from "@/lib/types";
import { SECTORS } from "@/lib/types";
import { BUNDLE_PLAN_IDS } from "@/lib/hub/plans";

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  businessName: z.string().min(1),
  sector: z.enum(SECTORS as [string, ...string[]]),
  // Every Loopdesk signup picks a bundle plan; it is paid on the Billing page.
  bundlePlan: z.enum(BUNDLE_PLAN_IDS as [string, ...string[]]),
  country: z.enum(["CA", "IN"]).optional(),
  phone: z.string().max(30).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, password, businessName, sector, bundlePlan, country, phone } = parsed.data;
  const email = parsed.data.email;
  if (!(await allow(`signup:ip:${clientIp(req)}`, 10, 60 * 60_000))) return NextResponse.json({ error: "Too many signups from this connection. Try again later." }, { status: 429 });

  let user;
  try {
    user = await createBundleOwner({ name, email, password, businessName, sector, bundlePlan: bundlePlan as FrontDeskPlan, country, phone });
  } catch (e) {
    if (e instanceof OnboardingError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const token = await createSessionToken({ userId: user.id, email: user.email });
  const res = NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email },
    next: bundlePlan ? "/dashboard/billing" : "/dashboard",
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
