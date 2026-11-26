import { NextRequest, NextResponse } from "next/server";
import { ToolWaError, WA_TOOLS, templatesForTool, verifyToolToken } from "@/lib/hub/tool-whatsapp";

export const dynamic = "force-dynamic";

/**
 * GET /api/hub/tools/loyvexa/whatsapp/templates — the tool's WhatsApp
 * templates with Meta's status, so it only lets people pick APPROVED ones.
 * Contract in lib/hub/tool-whatsapp.ts.
 */
export async function GET(req: NextRequest, { params }: { params: { tool: string } }) {
  const tool = WA_TOOLS[params.tool];
  if (!tool) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown tool" } }, { status: 404 });
  try {
    const businessId = await verifyToolToken(tool, req.headers.get("authorization"), "whatsapp-templates");
    return NextResponse.json(await templatesForTool(tool, businessId));
  } catch (err) {
    if (err instanceof ToolWaError) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    throw err;
  }
}
