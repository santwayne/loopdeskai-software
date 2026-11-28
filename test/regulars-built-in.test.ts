// Nov 2026: the separate Regulars app was merged into Loopdesk. "Regulars" in a
// plan or bundle now only turns on Loopdesk's own customer / offer / QR / loyalty
// pages. Nothing is set up on another server and no message is passed on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { BUILT_IN_TOOLS, TOOLS } from "../lib/hub/plans";
import { WA_TOOLS, TOOL_TEMPLATE_PREFIX } from "../lib/hub/tool-whatsapp";

const read = (p: string) => readFileSync(p, "utf8");

test("Regulars is built into Loopdesk, still a choice in plans and bundles", () => {
  assert.deepEqual(BUILT_IN_TOOLS, ["REGULARS"]);
  assert.ok(TOOLS.includes("REGULARS"));
});

test("set-up skips Regulars (no account on another server)", () => {
  const p = read("lib/hub/provision.ts");
  assert.match(p, /if \(BUILT_IN_TOOLS\.includes\(tool\)\) continue;/);
  assert.match(p, /if \(BUILT_IN_TOOLS\.includes\(tool\)\) return \{ tool, ok: true/);
  assert.doesNotMatch(p, /syncAllOptOutsToRegulars|regularsJoinCode/);
});

test("WhatsApp stays in Loopdesk: nothing is forwarded to or accepted from a Regulars app", () => {
  const hook = read("app/api/webhook/whatsapp/route.ts");
  assert.doesNotMatch(hook, /regularsTakesInbound|REGULARS_TOOL|pushOptOutToRegulars|regularsBusinessForJoinCode/);
  assert.equal(WA_TOOLS.regulars, undefined);
  assert.equal(TOOL_TEMPLATE_PREFIX.REGULARS, undefined);
  assert.doesNotMatch(read("lib/hub/tool-whatsapp.ts"), /pushOptOutToRegulars/);
  assert.doesNotMatch(read("lib/ingest-events.ts"), /pushOptOutToRegulars/);
});

test("no two-way customer sync any more", () => {
  for (const f of ["lib/hub/regulars-sync.ts", "lib/hub/regulars-opt-out.ts", "lib/sync-context.ts", "app/api/hub/tools/[tool]/sync/route.ts", "app/api/cron/hub-sync/route.ts", "scripts/regulars-sync-all.ts"]) {
    assert.equal(existsSync(f), false, f);
  }
  assert.doesNotMatch(read("lib/prisma.ts"), /\$use/);
  assert.doesNotMatch(read("app/api/cron/offers/route.ts"), /flushRegularsSync/);
});

test("'Open Regulars' goes to Loopdesk's own pages", () => {
  const open = read("app/api/hub/open/[tool]/route.ts");
  assert.match(open, /if \(BUILT_IN_TOOLS\.includes\(tool\)\)/);
  const home = read("components/hub-home.tsx");
  assert.doesNotMatch(home, /Open Regulars|Regulars account created/);
  assert.match(home, /plan\.tools\.filter\(\(t\) => !BUILT_IN_TOOLS\.includes\(t\)\)/);
  assert.match(home, /\{ href: "\/dashboard\/offers", label: "Offers" \}/);
});

test("the Regulars features are in Loopdesk", () => {
  for (const f of ["app/api/offers/media/route.ts", "app/api/media/offers/[id]/route.ts", "app/api/offers/rewrite/route.ts", "app/api/offers/suggestions/route.ts",
    "components/segment-offer-ideas.tsx", "lib/offer-ai.ts", "lib/offer-media.ts", "lib/segment-insights.ts", "lib/whatsapp-verify.ts",
    "components/business-name-form.tsx", "components/growth-retry-button.tsx", "scripts/clear-bad-whatsapp-ids.ts"]) {
    assert.equal(existsSync(f), true, f);
  }
  assert.match(read("prisma/schema.prisma"), /model OfferMedia \{/);
});
