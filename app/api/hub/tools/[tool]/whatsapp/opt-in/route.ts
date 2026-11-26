import { NextRequest, NextResponse } from "next/server";
import { ToolWaError, WA_TOOLS, setOptInForTool, verifyToolToken } from "@/lib/hub/tool-whatsapp";

/**
 * POST /api/hub/tools/loyvexa/whatsapp/opt-in — a person sent START (or the
 * business unblocked them) in the tool: clear STOP on this business's list
 * before the tool replies. Contract in lib/hub/tool-whatsapp.ts.
 */
export async function POST(req: NextRequest, { params }: { params: { tool: string } }) {
  const tool = WA_TOOLS[params.tool];
  if (!tool) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown tool" } }, { status: 404 });
  try {
    const businessId = await verifyToolToken(tool, req.headers.get("authorization"), "whatsapp-opt-in");
    const body = await req.json().catch(() => null);
    return NextResponse.json(await setOptInForTool(tool, businessId, body));
  } catch (err) {
    if (err instanceof ToolWaError) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    throw err;
  }
}
