import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logger";
import { bundleLive } from "@/lib/hub/plans";
import { businessTools } from "@/lib/hub/catalog-rules";
import { ToolWaError, verifyToolToken } from "@/lib/hub/tool-whatsapp";
import { applyRegularsSync } from "@/lib/hub/regulars-sync";

/**
 * POST /api/hub/tools/regulars/sync — Regulars sends its customers (and the
 * messages it stored) for a bundle client, so Loopdesk shows the same list
 * and chats (bug list 28 Nov 2026, A1/B5). Contract: lib/hub/regulars-sync.ts.
 */
export async function POST(req: NextRequest, { params }: { params: { tool: string } }) {
  if (params.tool !== "regulars") return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown tool" } }, { status: 404 });
  let businessId: string;
  try {
    businessId = await verifyToolToken("REGULARS", req.headers.get("authorization"), "customer-sync");
  } catch (err) {
    if (err instanceof ToolWaError) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    throw err;
  }
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Business not found" } }, { status: 404 });
  if (!bundleLive(business) || !businessTools(business).includes("REGULARS")) {
    return NextResponse.json({ error: { code: "NOT_IN_PLAN", message: "Regulars is not active in this business's bundle" } }, { status: 403 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await applyRegularsSync(businessId, await req.json().catch(() => null))) });
  } catch (err) {
    await logEvent({ businessId, source: "API", level: "ERROR", message: "Customer sync from Regulars failed", meta: { error: err instanceof Error ? err.message : String(err) } });
    return NextResponse.json({ error: { code: "SYNC_FAILED", message: "Sync failed" } }, { status: 500 });
  }
}
