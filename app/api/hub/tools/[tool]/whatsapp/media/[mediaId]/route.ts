import { NextRequest, NextResponse } from "next/server";
import { ToolWaError, WA_TOOLS, mediaForTool, verifyToolToken } from "@/lib/hub/tool-whatsapp";

/**
 * GET /api/hub/tools/sehat-saathi/whatsapp/media/:mediaId — a tool downloads a
 * photo / voice note / document that reached the business's number and was
 * forwarded to it. Contract in lib/hub/tool-whatsapp.ts.
 */
export async function GET(req: NextRequest, { params }: { params: { tool: string; mediaId: string } }) {
  const tool = WA_TOOLS[params.tool];
  if (!tool) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown tool" } }, { status: 404 });
  try {
    const businessId = await verifyToolToken(tool, req.headers.get("authorization"), "whatsapp-media");
    const { bytes, contentType } = await mediaForTool(tool, businessId, params.mediaId);
    return new NextResponse(bytes, { status: 200, headers: { "content-type": contentType, "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ToolWaError) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    throw err;
  }
}
