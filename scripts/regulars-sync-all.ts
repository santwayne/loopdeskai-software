/**
 * Bug list 28 Nov 2026, A1: first sync with Regulars after deploy. Marks every
 * customer of businesses whose bundle has Regulars (and their last 30 days of
 * messages) and sends them now. Regulars keeps what it has; new numbers are
 * added, empty names filled, STOP and consent merged (lib/customer-sync-rules.ts).
 * Safe to run again. Run Regulars' scripts/remove-dummy-customers.ts first.
 *   npx tsx scripts/regulars-sync-all.ts
 */
import "./load-env";
import { prisma } from "../lib/prisma";
import { flushRegularsSync, markAllForRegularsSync, regularsReady } from "../lib/hub/regulars-sync";

(async () => {
  if (!regularsReady()) { console.log("Regulars connection is not set in .env (REGULARS_API_URL and HUB_SECRET_REGULARS, 32+ characters). Nothing sent."); return; }
  const marked = await markAllForRegularsSync();
  console.log(`Marked ${marked} customer(s) of businesses with Regulars.`);
  const r = await flushRegularsSync();
  console.log(`Sent ${r.sent} to Regulars${r.failed ? `; ${r.failed} failed (see Admin → Logs; they go with the hourly cron)` : ""}.`);
})().finally(() => prisma.$disconnect());
