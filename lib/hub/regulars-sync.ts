import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logger";
import { withoutSync } from "@/lib/sync-context";
import { bundleLive } from "@/lib/hub/plans";
import { businessTools } from "@/lib/hub/catalog-rules";
import { signHubToken, toolSecret, toolUrl } from "@/lib/hub/tokens";
import {
  CUSTOMER_FIELDS, checkSyncBody, mergeIncoming, toSyncCustomer, toSyncMessage, type SyncCustomer, type SyncMessage,
} from "@/lib/customer-sync-rules";

/**
 * Loopdesk ⇄ Regulars customer sync (bug list 28 Nov 2026, A1/B5). Pankaj:
 * keep both databases, sync both ways, so a bundle client sees the same
 * customers, statuses and chats in both panels. Rules: lib/customer-sync-rules.ts
 * (same file in the Regulars repo).
 *
 *   Loopdesk → Regulars   POST {REGULARS_API_URL}/api/hub/sync
 *                         hub token, purpose "customer-sync", sub = our business id
 *                         { customers: SyncCustomer[], messages: SyncMessage[] }
 *   Regulars → Loopdesk   POST /api/hub/tools/regulars/sync  (same body)
 *                         tool token (iss "regulars"), purpose "customer-sync"
 *
 * Messages go both ways too (a copy, matched by Meta's message id), so a chat
 * shows in both inboxes and receipts update both copies.
 * Only for businesses whose live bundle has Regulars set up.
 */

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<unknown> | null = null;

const linked = { business: { toolAccounts: { some: { tool: "REGULARS", externalId: { not: null } } } } } as const;

export function regularsReady() {
  return !!toolUrl("REGULARS", "api") && !!toolSecret("REGULARS");
}

/** A customer / message changed: send pending rows in ~2 s (many changes → one push). */
export function scheduleRegularsSync(delayMs = 2000) {
  if (!regularsReady() || timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushRegularsSync().catch(() => {});
  }, delayMs);
}

export async function flushRegularsSync(): Promise<{ sent: number; failed: number }> {
  if (running) await running.catch(() => {});
  const p = doFlush();
  running = p;
  try { return await p; } finally { if (running === p) running = null; }
}

async function doFlush(): Promise<{ sent: number; failed: number }> {
  const api = toolUrl("REGULARS", "api");
  if (!api || !regularsReady()) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  const skip = new Set<string>();
  for (let round = 0; round < 40; round++) {
    const startedAt = new Date();
    const notSkipped = skip.size ? { businessId: { notIn: Array.from(skip) } } : {};
    const customers = await prisma.customer.findMany({
      where: { syncPending: true, ...linked, ...notSkipped },
      select: { ...CUSTOMER_FIELDS, id: true, businessId: true },
      orderBy: { syncChangedAt: "asc" },
      take: 500,
    });
    // Messages still being sent (no Meta id yet) wait for the next flush.
    const messages = await prisma.message.findMany({
      where: { syncPending: true, ...linked, ...notSkipped, OR: [{ status: { notIn: ["QUEUED", "SENDING"] } }, { status: null }, { createdAt: { lt: new Date(Date.now() - 120_000) } }] },
      select: { id: true, businessId: true, direction: true, channel: true, text: true, providerSid: true, status: true, purpose: true, createdAt: true, customer: { select: { phone: true } } },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    if (!customers.length && !messages.length) break;
    const groups = new Map<string, { customers: typeof customers; messages: typeof messages }>();
    const group = (id: string) => {
      if (!groups.has(id)) groups.set(id, { customers: [], messages: [] });
      return groups.get(id)!;
    };
    for (const c of customers) group(c.businessId).customers.push(c);
    for (const m of messages) group(m.businessId).messages.push(m);

    for (const [businessId, g] of Array.from(groups.entries())) {
      const business = await prisma.business.findUnique({ where: { id: businessId } });
      if (!business || business.status === "SUSPENDED" || !bundleLive(business) || !businessTools(business).includes("REGULARS")) {
        skip.add(businessId); // stays pending until Regulars is live again
        continue;
      }
      const body = {
        customers: g.customers.map(toSyncCustomer).filter((c): c is SyncCustomer => !!c),
        messages: g.messages.map(toSyncMessage).filter((m): m is SyncMessage => !!m),
      };
      try {
        if (body.customers.length || body.messages.length) {
          const res = await fetch(`${api}/api/hub/sync`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${await signHubToken("REGULARS", "customer-sync", businessId)}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
        }
        await withoutSync(async () => {
          // Rows changed again during the push stay pending.
          if (g.customers.length) await prisma.customer.updateMany({ where: { id: { in: g.customers.map((r) => r.id) }, OR: [{ syncChangedAt: { lte: startedAt } }, { syncChangedAt: null }] }, data: { syncPending: false } });
          if (g.messages.length) await prisma.message.updateMany({ where: { id: { in: g.messages.map((r) => r.id) } }, data: { syncPending: false } });
        });
        sent += body.customers.length + body.messages.length;
      } catch (err) {
        failed += g.customers.length + g.messages.length;
        skip.add(businessId);
        await logEvent({ businessId, source: "API", level: "WARN", message: "Could not sync customers to Regulars (will retry)", meta: { error: err instanceof Error ? err.message : String(err), customers: g.customers.length, messages: g.messages.length } });
      }
    }
    if (customers.length < 500 && messages.length < 500) break;
  }
  return { sent, failed };
}

/** Regulars' customers / messages → this business. Not marked for sending back. */
export async function applyRegularsSync(businessId: string, body: unknown) {
  const { customers, messages } = checkSyncBody(body);
  const business = await prisma.business.findUnique({ where: { id: businessId }, include: { locations: { orderBy: { createdAt: "asc" }, take: 1 } } });
  const first = business?.locations[0];
  if (!business || !first) throw new Error("Business has no location");
  let created = 0, updated = 0, stored = 0;

  await withoutSync(async () => {
    const byPhone = async (phone: string) => prisma.customer.findFirst({
      where: { businessId, phone: { in: [phone, `+${phone}`] } },
      orderBy: { firstSeenAt: "asc" },
    });
    for (const inc of customers) {
      const local = await byPhone(inc.phone);
      const merged = mergeIncoming(local, inc);
      if (!merged) continue;
      if ("create" in merged) {
        await prisma.customer.create({ data: { businessId, locationId: first.id, phone: inc.phone, preferredChannel: "WHATSAPP", ...merged.create, syncChangedAt: new Date(inc.changedAt) } }).catch((err) => {
          if (String((err as { code?: string })?.code) !== "P2002") throw err;
        });
        created++;
      } else {
        await prisma.customer.update({ where: { id: local!.id }, data: { ...merged.update, syncChangedAt: new Date(inc.changedAt) } });
        updated++;
      }
    }
    for (const m of messages) {
      let customer = await byPhone(m.phone);
      if (!customer) {
        // The customer row hasn't arrived yet: hold marketing (PENDING) until it does.
        customer = await prisma.customer.create({ data: { businessId, locationId: first.id, phone: m.phone, consentStatus: "PENDING", consentSource: "MANAGER" } }).catch(() => null)
          ?? await byPhone(m.phone);
        if (!customer) continue;
      }
      const at = new Date(m.createdAt);
      const r = await prisma.message.create({
        data: {
          businessId, locationId: customer.locationId, customerId: customer.id, direction: m.direction, channel: m.channel || "WHATSAPP",
          purpose: m.purpose ?? (m.direction === "INBOUND" ? "REPLY" : "OTHER"), status: m.status, providerSid: m.providerSid || `mirror:${m.id}`,
          text: m.text, createdAt: at, readAt: m.direction === "OUTBOUND" ? at : null, syncOrigin: "regulars",
        },
      }).catch((err) => {
        if (String((err as { code?: string })?.code) === "P2002") return null;
        throw err;
      });
      if (r) stored++;
    }
  });
  return { created, updated, stored };
}

/**
 * A3/B3 (28 Nov 2026): "JOIN 9H75JS" from a Regulars QR isn't one of our codes.
 * Ask Regulars which of our businesses it belongs to (null = nobody's).
 */
export async function regularsBusinessForJoinCode(code: string): Promise<string | null> {
  const api = toolUrl("REGULARS", "api");
  if (!api || !toolSecret("REGULARS") || !/^[A-Z0-9]{4,12}$/i.test(code)) return null;
  try {
    const res = await fetch(`${api}/api/hub/join-code`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await signHubToken("REGULARS", "join-lookup", "lookup")}` },
      body: JSON.stringify({ code: code.toUpperCase() }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = (await res.json().catch(() => ({}))) as { hubBusinessId?: unknown };
    return typeof d.hubBusinessId === "string" ? d.hubBusinessId : null;
  } catch (err) {
    await logEvent({ source: "WHATSAPP", level: "WARN", message: "Could not ask Regulars about a QR join code", meta: { code, error: err instanceof Error ? err.message : String(err) } });
    return null;
  }
}

/** Marks every customer (and last 30 days of messages) of businesses with Regulars for sending. */
export async function markAllForRegularsSync(businessId?: string) {
  const rows = await prisma.customer.findMany({ where: { ...linked, ...(businessId ? { businessId } : {}) }, select: { id: true } });
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    await withoutSync(async () => {
      await prisma.customer.updateMany({ where: { id: { in: chunk } }, data: { syncPending: true } });
      await prisma.message.updateMany({ where: { customerId: { in: chunk }, syncOrigin: null, channel: { not: "INSTAGRAM" }, createdAt: { gte: new Date(Date.now() - 30 * 864e5) } }, data: { syncPending: true } });
    });
  }
  return ids.length;
}
