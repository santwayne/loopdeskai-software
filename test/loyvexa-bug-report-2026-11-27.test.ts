// Loyvexa bug report, 27 Nov 2026 — the Loopdesk side of #2, #3, #4 and #5.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Business, Location } from "@prisma/client";
import { phoneVariants, pickOwnerToolRoute, replySender } from "../lib/hub/tool-whatsapp";
import { lintToolTemplates, toolMetaTemplates } from "../lib/hub/tool-templates";

test("#2 owner's phone that is also a Loyvexa dealer: STOP / hi go to Loyvexa, not OWNER_NOT_INBOX", () => {
  // Loyvexa wrote to this phone for the owner's own business
  assert.deepEqual(pickOwnerToolRoute("biz-1", { tool: "LOYVEXA" }, null, false), { tool: "LOYVEXA", businessId: "biz-1" });
  // Loyvexa of another business on the shared number wrote to it, and is live there
  assert.deepEqual(pickOwnerToolRoute("biz-1", null, { tool: "LOYVEXA", businessId: "biz-2" }, true), { tool: "LOYVEXA", businessId: "biz-2" });
  // …but not if Loyvexa is not live in that business any more
  assert.equal(pickOwnerToolRoute("biz-1", null, { tool: "LOYVEXA", businessId: "biz-2" }, false), null);
  // no tool ever wrote to this phone → the owner gets the usual OWNER_NOT_INBOX note
  assert.equal(pickOwnerToolRoute("biz-1", null, null, false), null);
});

test("#3 the STOP check reads the same phone spellings that START clears", () => {
  assert.deepEqual(phoneVariants("919814000102").sort(), ["+919814000102", "09814000102", "919814000102", "9814000102"].sort());
});

test("#4 every Loyvexa template is defined (so `npm run wa:templates` submits it) and passes Meta's rules", () => {
  assert.deepEqual(lintToolTemplates(), []);
  const all = toolMetaTemplates();
  const names = ["loyvexa_participant_created", "loyvexa_redemption_paid", "loyvexa_redemption_failed", "loyvexa_redemption_rejected", "loyvexa_scheme_bonus",
    "loyvexa_purchase_recorded", "loyvexa_order_sent", "loyvexa_order_failed", "loyvexa_points_expiring", "loyvexa_points_expired", "loyvexa_ai_slab", "loyvexa_ai_mechanic"];
  // parameter counts must match what Loyvexa sends (src/services/notifications.js, ai/messaging.js)
  const params: Record<string, number> = { loyvexa_participant_created: 2, loyvexa_redemption_paid: 3, loyvexa_redemption_failed: 2, loyvexa_redemption_rejected: 3, loyvexa_scheme_bonus: 3,
    loyvexa_purchase_recorded: 3, loyvexa_order_sent: 3, loyvexa_order_failed: 1, loyvexa_points_expiring: 3, loyvexa_points_expired: 2, loyvexa_ai_slab: 5, loyvexa_ai_mechanic: 3 };
  for (const n of names) {
    const rows = all.filter((t) => t.name === n);
    assert.deepEqual(rows.map((t) => t.language).sort(), ["en", "hi"], n);
    for (const t of rows) assert.equal(new Set(t.components[0].text.match(/\{\{\d+\}\}/g)).size, params[n], `${n}/${t.language}`);
  }
});

test("#5 inside 24 h a tool's reply leaves from the number the person wrote to", () => {
  process.env.WHATSAPP_SHARED_PHONE_NUMBER_ID = "SHARED"; process.env.WHATSAPP_SHARED_ACCESS_TOKEN = "t";
  const own = { id: "loc-own", whatsappPhoneNumberId: "OWN", whatsappAccessToken: "x" } as unknown as Location;
  const business = { id: "b", country: "IN", locations: [own] } as unknown as Business & { locations: Location[] };
  const picked = { business, location: own, sender: { phoneNumberId: "OWN", accessToken: "x", shared: false } };
  const now = new Date("2026-11-27T10:00:00Z");
  const ago = (h: number) => new Date(now.getTime() - h * 3600e3);
  // dealer wrote to the shared number 1 h ago → reply from the shared number (was: own number → #131047)
  assert.equal(replySender(picked, { locationId: null, lastInboundAt: ago(1) }, now).sender.phoneNumberId, "SHARED");
  // dealer wrote to the business's own number → own number
  assert.equal(replySender(picked, { locationId: "loc-own", lastInboundAt: ago(1) }, now).sender.phoneNumberId, "OWN");
  // window closed or no contact → the business's usual number (templates only anyway)
  assert.equal(replySender(picked, { locationId: null, lastInboundAt: ago(30) }, now).sender.phoneNumberId, "OWN");
  assert.equal(replySender(picked, null, now).sender.phoneNumberId, "OWN");
});
