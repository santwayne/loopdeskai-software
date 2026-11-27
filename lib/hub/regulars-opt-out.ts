import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logger";
import { bundleLive } from "@/lib/hub/plans";
import { businessTools } from "@/lib/hub/catalog-rules";
import { signHubToken, toolSecret, toolUrl } from "@/lib/hub/tokens";

/**
 * STOP said here must stop Regulars too (Regulars bug list #1, 27 Nov 2026:
 * +91 70870 64479 was "Opted out" in Loopdesk but "Waiting for YES" in
 * Regulars, which then tried to ask again — a WhatsApp policy risk).
 *
 *   hub → Regulars   POST {REGULARS_API_URL}/api/hub/opt-out
 *                    Bearer hub token, purpose "opt-out", sub = Loopdesk business id
 *                    { hubBusinessId, phones: [digits…] (≤ 500), optedOut }
 *
 * Only for businesses whose live bundle includes Regulars and whose Regulars
 * account is set up. Never throws: a failure is logged, the STOP here stands.
 */
export async function pushOptOutToRegulars(businessId: string, phones: string[], optedOut: boolean): Promise<number> {
  const api = toolUrl("REGULARS", "api");
  if (!api || !toolSecret("REGULARS") || !phones.length) return 0;
  try {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business || !bundleLive(business) || !businessTools(business).includes("REGULARS")) return 0;
    const account = await prisma.toolAccount.findUnique({ where: { businessId_tool: { businessId, tool: "REGULARS" } } });
    if (!account?.externalId) return 0;
    let updated = 0;
    const digits = Array.from(new Set(phones.map((p) => String(p).replace(/\D/g, "")).filter((p) => p.length >= 10 && p.length <= 15)));
    for (let i = 0; i < digits.length; i += 500) {
      const token = await signHubToken("REGULARS", "opt-out", businessId);
      const res = await fetch(`${api}/api/hub/opt-out`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ hubBusinessId: businessId, phones: digits.slice(i, i + 500), optedOut }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
      updated += Number(((await res.json().catch(() => ({}))) as { updated?: number }).updated ?? 0);
    }
    return updated;
  } catch (err) {
    await logEvent({ businessId, source: "WHATSAPP", level: "ERROR", message: "Could not pass an opt-out on to Regulars", meta: { error: err instanceof Error ? err.message : String(err), optedOut, count: phones.length } });
    return 0;
  }
}

/** After Regulars is set up: send every number that already said STOP here. */
export async function syncAllOptOutsToRegulars(businessId: string): Promise<number> {
  const rows = await prisma.customer.findMany({ where: { businessId, optedOut: true }, select: { phone: true }, take: 20000 });
  return pushOptOutToRegulars(businessId, rows.map((r) => r.phone), true);
}
