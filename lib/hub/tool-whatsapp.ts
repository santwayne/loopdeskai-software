import type { Business, Location } from "@prisma/client";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logger";
import { bundleLive, type Tool } from "@/lib/hub/plans";
import { businessTools } from "@/lib/hub/catalog-rules";
import { signHubToken, toolSecret, toolUrl } from "@/lib/hub/tokens";
import { graphSend, whatsappLimitReached } from "@/lib/whatsapp-send";
import { whatsappSenderFor, type WaSender } from "@/lib/whatsapp-sender";

/**
 * Bundle rule 4 (Nov 2026): one client = one WhatsApp number, and it lives
 * here in Regulars. Tools that talk to people on WhatsApp (today: Loyvexa,
 * its dealer / mechanic bot, OTPs, scheme messages, campaigns) don't keep a
 * number of their own:
 *
 *   tool → hub   POST /api/hub/tools/loyvexa/whatsapp/send
 *                Bearer HS256 JWT signed with HUB_SECRET_<TOOL>:
 *                iss <tool audience> ("loyvexa")  aud "regulars-hub"
 *                sub <Regulars business id>  purpose "whatsapp-send"  jti  exp ≤ 2 min
 *                body { to, message }  (message = WhatsApp Cloud API payload, type text | template)
 *                → { messageId }
 *
 *   hub → tool   POST {LOYVEXA_API_URL}/api/hub/whatsapp/inbound
 *                Bearer hub token, purpose "whatsapp-inbound"
 *                { messages: [{ from, text, id }], statuses: [{ id, status, error }] }
 *
 * The number used is the business's usual one (its own, else the shared
 * Loopdesk number). People a tool has written to are remembered in
 * HubWaContact, so their replies go back to that tool instead of the
 * Regulars inbox, and on the shared number they route to the right business.
 */

/** Tools that may send WhatsApp through the hub. */
export const WA_TOOLS: Partial<Record<string, Tool>> = { loyvexa: "LOYVEXA", "sehat-saathi": "SEHAT_SAATHI" };
const TOOL_ISSUER: Partial<Record<Tool, string>> = { LOYVEXA: "loyvexa", SEHAT_SAATHI: "sehat-saathi" };

/**
 * Sehat Saathi (hospital package) differs from Loyvexa in three ways:
 *  - patients write FIRST (QR / bed code on the ward wall), so on a hospital's
 *    number a message from someone no tool or Regulars has written to goes to
 *    Sehat Saathi instead of the Regulars inbox (DEFAULT_INBOUND_TOOL);
 *  - it needs the whole WhatsApp message (prescription photos, voice notes,
 *    documents), not just the text (RAW_INBOUND);
 *  - it downloads that media through the hub, because the media belongs to the
 *    business's WABA: GET /api/hub/tools/sehat-saathi/whatsapp/media/:mediaId
 *    (purpose "whatsapp-media"), only for media the hub forwarded to it.
 * It may also send a WhatsApp catalog button (pharmacy refills).
 */
const RAW_INBOUND: Tool[] = ["SEHAT_SAATHI"];
export const DEFAULT_INBOUND_TOOL: Tool = "SEHAT_SAATHI";
const MEDIA_TYPES = ["image", "audio", "document", "video", "sticker"];

export class ToolWaError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Digits only: "+91 98140-00101" → "919814000101". */
export const waDigits = (s: string) => String(s ?? "").replace(/\D/g, "");

/**
 * Checks the payload a tool asks us to send. Only plain text and approved
 * templates; nothing that could address someone else or change the sender.
 */
export function checkToolMessage(body: unknown): { to: string; message: Record<string, unknown>; kind: "text" | "template" | "interactive"; templateName: string | null } {
  const b = (body ?? {}) as { to?: unknown; message?: Record<string, unknown> };
  const to = waDigits(String(b.to ?? ""));
  if (to.length < 10 || to.length > 15) throw new ToolWaError(400, "BAD_NUMBER", "to must be a mobile number with country code");
  const m = b.message;
  if (!m || typeof m !== "object") throw new ToolWaError(400, "BAD_MESSAGE", "message is required");
  if (m.type === "text") {
    const text = (m.text as { body?: unknown } | undefined)?.body;
    if (typeof text !== "string" || !text.trim()) throw new ToolWaError(400, "BAD_MESSAGE", "text.body is required");
    return { to, kind: "text", templateName: null, message: { type: "text", text: { preview_url: true, body: text.slice(0, 4096) } } };
  }
  if (m.type === "template") {
    const t = (m.template ?? {}) as { name?: unknown; language?: { code?: unknown }; components?: unknown };
    if (typeof t.name !== "string" || !/^[a-z0-9_]{1,512}$/.test(t.name)) throw new ToolWaError(400, "BAD_TEMPLATE", "template.name must be a Meta template name");
    const code = typeof t.language?.code === "string" ? t.language.code : "en";
    const components = Array.isArray(t.components) ? t.components : [];
    return { to, kind: "template", templateName: t.name, message: { type: "template", template: { name: t.name, language: { code }, components } } };
  }
  // WhatsApp catalog button (Sehat Saathi pharmacy refills). Only the catalog
  // message shape: no buttons that could open other links or act for the business.
  if (m.type === "interactive") {
    const i = (m.interactive ?? {}) as { type?: unknown; body?: { text?: unknown }; action?: { name?: unknown; parameters?: Record<string, unknown> } };
    const text = i.body?.text;
    if (i.type !== "catalog_message" || i.action?.name !== "catalog_message" || typeof text !== "string" || !text.trim()) {
      throw new ToolWaError(400, "BAD_MESSAGE", "only interactive catalog_message is allowed");
    }
    const thumb = i.action?.parameters?.thumbnail_product_retailer_id;
    return {
      to, kind: "interactive" as const, templateName: null,
      message: { type: "interactive", interactive: { type: "catalog_message", body: { text: text.slice(0, 1024) }, action: { name: "catalog_message", parameters: typeof thumb === "string" ? { thumbnail_product_retailer_id: thumb } : {} } } },
    };
  }
  throw new ToolWaError(400, "BAD_MESSAGE", "message.type must be text, template or interactive catalog_message");
}

/** OTPs still go to people who sent STOP (they asked for the code); nothing else does. */
export const isOtpTemplate = (name: string | null) => !!name && /(^|_)otp($|_)/.test(name);

/** Single use for tool tokens (2-minute tokens; the row is just a marker). */
async function burnJti(jti: string) {
  try {
    await prisma.rateLimit.create({ data: { key: `hubjti:${jti}`, count: 1, resetAt: new Date(Date.now() + 10 * 60_000) } });
  } catch {
    throw new ToolWaError(401, "TOKEN_USED", "Hub token already used");
  }
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: "hubjti:" }, resetAt: { lt: new Date() } } }).catch(() => {});
}

/** Verifies a tool → hub token and returns the business it is for. */
export async function verifyToolToken(tool: Tool, authorization: string | null, purpose: string) {
  const secret = toolSecret(tool);
  if (!secret) throw new ToolWaError(503, "HUB_DISABLED", "Hub secret for this tool is not set");
  const token = (authorization ?? "").startsWith("Bearer ") ? authorization!.slice(7) : "";
  if (!token) throw new ToolWaError(401, "UNAUTHORIZED", "Missing token");
  let claims: Record<string, unknown>;
  try {
    ({ payload: claims } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"], issuer: TOOL_ISSUER[tool], audience: "regulars-hub", maxTokenAge: "3m",
    }));
  } catch {
    throw new ToolWaError(401, "UNAUTHORIZED", "Invalid or expired token");
  }
  if (claims.purpose !== purpose || typeof claims.sub !== "string" || typeof claims.jti !== "string") throw new ToolWaError(401, "UNAUTHORIZED", "Wrong token");
  await burnJti(claims.jti);
  return claims.sub;
}

/** The business, its sending location and number, if the tool is live for it. */
async function senderForTool(businessId: string, tool: Tool): Promise<{ business: Business; location: Location; sender: WaSender }> {
  const business = await prisma.business.findUnique({ where: { id: businessId }, include: { locations: { orderBy: { createdAt: "asc" } } } });
  if (!business) throw new ToolWaError(404, "NOT_FOUND", "Business not found");
  if (business.status === "SUSPENDED" || !bundleLive(business) || !businessTools(business).includes(tool)) {
    throw new ToolWaError(403, "NOT_IN_PLAN", "This tool is not active in the business's bundle");
  }
  // The location with its own number first, else the first one (shared number).
  const location = business.locations.find((l) => l.whatsappPhoneNumberId && l.whatsappAccessToken) ?? business.locations[0];
  const sender = location ? whatsappSenderFor(location, business) : null;
  if (!location || !sender) throw new ToolWaError(409, "NO_WHATSAPP", "This business has no WhatsApp number set up in Regulars Settings");
  return { business, location, sender };
}

/** Send for a tool. Returns Meta's message id. */
export async function sendForTool(tool: Tool, businessId: string, body: unknown): Promise<{ messageId: string }> {
  const msg = checkToolMessage(body);
  const { business, location, sender } = await senderForTool(businessId, tool);
  // Same STOP list everywhere: someone who opted out of this business here gets nothing but OTPs.
  if (!isOtpTemplate(msg.templateName)) {
    const out = await prisma.customer.findFirst({ where: { businessId: business.id, phone: { in: [msg.to, `+${msg.to}`] }, optedOut: true }, select: { id: true } });
    if (out) throw new ToolWaError(409, "OPTED_OUT", "This person sent STOP to the business");
  }
  // The business's monthly WhatsApp allowance covers the tools' messages too (OTPs always go).
  if (!isOtpTemplate(msg.templateName) && (await whatsappLimitReached(business))) {
    throw new ToolWaError(429, "MONTHLY_LIMIT", "This business has used its WhatsApp messages for this month");
  }
  const r = await graphSend(sender, msg.to, msg.message);
  if (!r.ok || !r.id) {
    await logEvent({ businessId: business.id, source: "WHATSAPP", level: "WARN", message: `${tool} WhatsApp not sent`, meta: { error: r.error, code: r.code } });
    throw new ToolWaError(502, "WHATSAPP_FAILED", r.error ?? "WhatsApp send failed");
  }
  const now = new Date();
  await prisma.usageEvent.create({ data: { businessId: business.id, type: "WHATSAPP_SENT" } });
  await prisma.hubWaContact.upsert({
    where: { businessId_tool_phone: { businessId: business.id, tool, phone: msg.to } },
    create: { businessId: business.id, tool, phone: msg.to, locationId: sender.shared ? null : location.id, lastOutboundAt: now },
    update: { lastOutboundAt: now, locationId: sender.shared ? null : location.id },
  });
  await prisma.hubWaMessage.create({ data: { providerSid: r.id, businessId: business.id, tool } }).catch(() => {});
  prisma.hubWaMessage.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 14 * 864e5) } } }).catch(() => {});
  return { messageId: r.id };
}

/**
 * Shared number: the tool contact that last heard from a business (any business
 * on the shared number), or null. Used next to Regulars' own "last outbound".
 */
export async function latestSharedToolContact(phone: string) {
  return prisma.hubWaContact.findFirst({
    where: { phone: waDigits(phone), locationId: null, lastOutboundAt: { not: null } },
    orderBy: { lastOutboundAt: "desc" },
  });
}


async function postToTool(tool: Tool, businessId: string, body: unknown) {
  const api = toolUrl(tool, "api");
  if (!api || !toolSecret(tool)) throw new Error(`${tool} API URL or hub secret not set`);
  const token = await signHubToken(tool, "whatsapp-inbound", businessId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${api}/api/hub/whatsapp/inbound`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** A message from one of the tool's people → the tool (its bot answers through sendForTool). */
export async function forwardInbound(tool: Tool, businessId: string, m: { from: string; text: string | null; id: string }, raw?: Record<string, unknown>) {
  const phone = waDigits(m.from);
  const now = new Date();
  // A patient's first message (Sehat Saathi): remember them so replies keep coming here.
  await prisma.hubWaContact.upsert({
    where: { businessId_tool_phone: { businessId, tool, phone } },
    create: { businessId, tool, phone, lastInboundAt: now },
    update: { lastInboundAt: now },
  });
  const wantsRaw = RAW_INBOUND.includes(tool) && !!raw;
  if (wantsRaw) {
    // Media the tool may download (and only this media): see mediaForTool.
    const type = String(raw!.type ?? "");
    const mediaId = MEDIA_TYPES.includes(type) ? (raw![type] as { id?: unknown } | undefined)?.id : null;
    if (typeof mediaId === "string") {
      await prisma.hubWaMessage.upsert({ where: { providerSid: `media:${mediaId}` }, create: { providerSid: `media:${mediaId}`, businessId, tool }, update: {} }).catch(() => {});
    }
  }
  try {
    await postToTool(tool, businessId, { messages: [wantsRaw ? { ...raw, from: phone } : { from: phone, text: m.text, id: m.id }] });
  } catch (err) {
    await logEvent({ businessId, source: "WHATSAPP", level: "ERROR", message: `Could not pass a WhatsApp message on to ${tool}`, meta: { error: err instanceof Error ? err.message : String(err) } });
  }
}

/** Meta receipts for messages a tool sent → that tool. */
export async function forwardStatuses(statuses: { id: string; status: string; errors?: { title?: string }[] }[]) {
  if (!statuses.length) return;
  const rows = await prisma.hubWaMessage.findMany({ where: { providerSid: { in: statuses.map((s) => s.id) } } });
  const groups = new Map<string, { tool: Tool; businessId: string; items: { id: string; status: string; error: string | null }[] }>();
  for (const r of rows) {
    const s = statuses.find((x) => x.id === r.providerSid)!;
    const k = `${r.tool}:${r.businessId}`;
    if (!groups.has(k)) groups.set(k, { tool: r.tool as Tool, businessId: r.businessId, items: [] });
    groups.get(k)!.items.push({ id: s.id, status: s.status, error: s.errors?.[0]?.title ?? null });
  }
  for (const g of Array.from(groups.values())) {
    await postToTool(g.tool, g.businessId, { statuses: g.items }).catch(() => {});
  }
}

/**
 * Does an inbound message belong to a tool? Yes when a tool has written to
 * this phone for this business, and more recently than Regulars itself did
 * (a dealer who is also a shop customer goes to whoever spoke last).
 */
export async function inboundTool(businessId: string, phone: string, tools: Tool[] = []): Promise<Tool | null> {
  const digits = waDigits(phone);
  // Only tools that are live in this business's bundle: a lapsed or removed
  // Loyvexa must not keep taking the business's customers' messages.
  const c = await prisma.hubWaContact.findFirst({ where: { businessId, phone: digits, tool: { in: tools } }, orderBy: { lastOutboundAt: "desc" } });
  if (!c) {
    // Hospital package: a stranger writing to the hospital is a (new) patient.
    // Someone Regulars already talks to stays with Regulars.
    if (!tools.includes(DEFAULT_INBOUND_TOOL)) return null;
    const known = await prisma.customer.findFirst({ where: { businessId, phone: { in: [digits, `+${digits}`] } }, select: { id: true } });
    return defaultInboundOwner(tools, !!known);
  }
  const ours = await prisma.message.findFirst({
    where: { businessId, channel: "WHATSAPP", direction: "OUTBOUND", customer: { phone: { in: [digits, `+${digits}`] } } },
    orderBy: { createdAt: "desc" }, select: { createdAt: true },
  });
  return pickInboundOwner(c, ours?.createdAt ?? null) ? (c.tool as Tool) : null;
}

/** Pure part of inboundTool (unit-tested). */
export function pickInboundOwner(contact: { lastOutboundAt: Date | null; createdAt: Date }, regularsLastOutbound: Date | null) {
  const toolAt = contact.lastOutboundAt ?? contact.createdAt;
  return !regularsLastOutbound || toolAt.getTime() >= regularsLastOutbound.getTime();
}

/** Pure part of the hospital default (unit-tested). */
export function defaultInboundOwner(tools: Tool[], knownToRegulars: boolean): Tool | null {
  return tools.includes(DEFAULT_INBOUND_TOOL) && !knownToRegulars ? DEFAULT_INBOUND_TOOL : null;
}

/**
 * Media a tool was forwarded (prescription photo, voice note) → its bytes.
 * Only media the hub passed to this tool for this business can be fetched.
 */
export async function mediaForTool(tool: Tool, businessId: string, mediaId: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  if (!/^[A-Za-z0-9_.-]{1,200}$/.test(mediaId)) throw new ToolWaError(400, "BAD_MEDIA", "Bad media id");
  const mark = await prisma.hubWaMessage.findUnique({ where: { providerSid: `media:${mediaId}` } });
  if (!mark || mark.businessId !== businessId || mark.tool !== tool) throw new ToolWaError(404, "NOT_FOUND", "Media not found for this business");
  const { sender } = await senderForTool(businessId, tool);
  const graph = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v21.0"}`;
  const meta = await fetch(`${graph}/${mediaId}`, { headers: { authorization: `Bearer ${sender.accessToken}` } });
  const info = (await meta.json().catch(() => ({}))) as { url?: string; mime_type?: string; error?: { message?: string } };
  if (!meta.ok || !info.url) throw new ToolWaError(502, "MEDIA_FAILED", info.error?.message ?? `Media lookup failed (HTTP ${meta.status})`);
  const file = await fetch(info.url, { headers: { authorization: `Bearer ${sender.accessToken}` } });
  if (!file.ok) throw new ToolWaError(502, "MEDIA_FAILED", `Media download failed (HTTP ${file.status})`);
  return { bytes: await file.arrayBuffer(), contentType: file.headers.get("content-type") || info.mime_type || "application/octet-stream" };
}

/* ───────────────────────── Opt-in / opt-out sync ─────────────────────────
 * tool → hub   POST /api/hub/tools/loyvexa/whatsapp/opt-in
 *              Bearer tool token, purpose "whatsapp-opt-in"
 *              body { to, optIn: true | false }  → { ok, updated }
 *
 * Loyvexa testing report 2 #1: a dealer sent STOP, then START. Loyvexa cleared
 * its own flag, but sendForTool still refused the reply ("This person sent
 * STOP to the business") because the customer row here stayed optedOut.
 * Loyvexa now calls this before replying to START / YES, and from its
 * console's "Unblock WhatsApp" button (the business owner's own action).
 * optIn false records STOP on rows that exist (Loyvexa keeps its own list too).
 */
export function checkOptInBody(body: unknown): { to: string; optIn: boolean } {
  const b = (body ?? {}) as { to?: unknown; optIn?: unknown };
  const to = waDigits(String(b.to ?? ""));
  if (to.length < 10 || to.length > 15) throw new ToolWaError(400, "BAD_NUMBER", "to must be a mobile number with country code");
  if (typeof b.optIn !== "boolean") throw new ToolWaError(400, "BAD_BODY", "optIn must be true or false");
  return { to, optIn: b.optIn };
}

/** Phone spellings a customer row may have for these digits. */
export const phoneVariants = (digits: string) => {
  const out = new Set([digits, `+${digits}`]);
  if (digits.length === 12 && digits.startsWith("91")) { out.add(digits.slice(2)); out.add(`0${digits.slice(2)}`); }
  return Array.from(out);
};

export async function setOptInForTool(tool: Tool, businessId: string, body: unknown): Promise<{ ok: true; updated: number }> {
  const { to, optIn } = checkOptInBody(body);
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, status: true } });
  if (!business) throw new ToolWaError(404, "NOT_FOUND", "Business not found");
  const now = new Date();
  const r = await prisma.customer.updateMany({
    where: { businessId, phone: { in: phoneVariants(to) }, optedOut: !optIn },
    data: optIn ? { optedOut: false, optedOutAt: null } : { optedOut: true, optedOutAt: now },
  });
  await logEvent({ businessId, source: "WHATSAPP", level: "INFO", message: `${tool}: ${optIn ? "opted back in (START)" : "opted out (STOP)"}`, meta: { to, updated: r.count } });
  return { ok: true, updated: r.count };
}

/* ───────────────────────── Approved templates for a tool ─────────────────
 * tool → hub   GET /api/hub/tools/loyvexa/whatsapp/templates
 *              Bearer tool token, purpose "whatsapp-templates"
 *              → { templates: [{ name, language, category, body, params, status }] }
 *
 * Loyvexa testing report 2 #6: a campaign ran with loyvexa_scheme_bonus that
 * Meta had not approved. Loyvexa now only offers templates listed here with
 * status APPROVED. Only the tool's own templates (name prefix "loyvexa_",
 * "sehat_") from the WhatsApp Business Account the business sends from.
 * The shared Loopdesk number uses WHATSAPP_SHARED_WABA_ID. A location with
 * its own number has no WABA ID saved here yet → 409 NO_WABA.
 */
export const TOOL_TEMPLATE_PREFIX: Partial<Record<Tool, string>> = { LOYVEXA: "loyvexa_", SEHAT_SAATHI: "sehat_" };

type MetaTpl = { name: string; language: string; status: string; category?: string; components?: { type: string; text?: string }[] };
const countVars = (text: string) => new Set(text.match(/\{\{\s*\d+\s*\}\}/g) ?? []).size;

/** Pure part (unit-tested): the tool's templates, in Loyvexa's shape. */
export function toolTemplatesFrom(meta: MetaTpl[], prefix: string) {
  return meta.filter((t) => t.name.startsWith(prefix)).map((t) => {
    const body = t.components?.find((c) => c.type === "BODY")?.text ?? null;
    return { name: t.name, language: t.language, category: t.category ?? null, body, params: body ? countVars(body) : 0, status: String(t.status || "").toUpperCase() };
  });
}

export async function templatesForTool(tool: Tool, businessId: string) {
  const { sender } = await senderForTool(businessId, tool);
  const wabaId = sender.shared ? process.env.WHATSAPP_SHARED_WABA_ID : null;
  if (!wabaId) throw new ToolWaError(409, "NO_WABA", sender.shared ? "WHATSAPP_SHARED_WABA_ID is not set on the Loopdesk server" : "This business sends from its own number, and its WhatsApp Business Account ID is not saved in Loopdesk yet");
  const graph = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v21.0"}`;
  const all: MetaTpl[] = [];
  let url: string | null = `${graph}/${wabaId}/message_templates?fields=name,language,status,category,components&limit=200`;
  for (let page = 0; url && page < 10; page++) {
    const res: Response = await fetch(url, { headers: { authorization: `Bearer ${sender.accessToken}` }, signal: AbortSignal.timeout(10000) });
    const data = (await res.json().catch(() => ({}))) as { data?: MetaTpl[]; paging?: { next?: string }; error?: { message?: string } };
    if (!res.ok) throw new ToolWaError(502, "META_FAILED", `Meta ${res.status}: ${data.error?.message ?? "could not list templates"}`);
    all.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }
  return { templates: toolTemplatesFrom(all, TOOL_TEMPLATE_PREFIX[tool] ?? "") };
}
