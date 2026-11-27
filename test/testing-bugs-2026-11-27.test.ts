// Fixes from the Loopdesk AI testing bug list (27 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { counterNotes } from "../lib/counter-notes";
import { WA_TEMPLATE_DEFS, templateName } from "../lib/whatsapp-templates";
import { OWNER_NOT_INBOX } from "../lib/staff";

const webhook = readFileSync("app/api/webhook/whatsapp/route.ts", "utf8");

test("bugs 1 + 2: a QR JOIN is decided before Loyvexa / staff / owner routing", () => {
  const joinAt = webhook.indexOf("const joining =");
  assert.ok(joinAt > 0);
  for (const later of ["handleStaffMessage(", "handleOwnerReply(", "inboundTool("]) {
    assert.ok(webhook.indexOf(later) > joinAt, `${later} must come after the JOIN check`);
  }
  assert.match(webhook, /const tool = joining \? null : await inboundTool\(/);
  assert.match(webhook, /text && !joining && \(await handleStaffMessage\(/);
  assert.match(webhook, /if \(joining && qrJoin\)/);
});

test("bug 2: only tools live in the bundle take a business's inbound messages", () => {
  assert.match(readFileSync("lib/hub/tool-whatsapp.ts", "utf8"), /hubWaContact\.findFirst\(\{ where: \{ businessId, phone: digits, tool: \{ in: tools \} \}/);
});

test("bug 3: the owner writing to the shared number gets told why it isn't in the inbox", () => {
  assert.match(webhook, /if \(fromOwner && !joining\)/);
  assert.match(webhook, /text: OWNER_NOT_INBOX/);
  assert.match(OWNER_NOT_INBOX, /Inbox/);
});

const base = { loyaltyEnabled: true, pointsPer100: 5, autoFeedback: true, autoReviewRequest: false };

test("bug 4: the counter says why a bill got no points", () => {
  assert.match(counterNotes({ ...base, loyaltyEnabled: false }, { amount: 500, pointsAwarded: false })[0], /loyalty is switched off/);
  assert.match(counterNotes({ ...base, pointsPer100: 0 }, { amount: 500, pointsAwarded: false })[0], /points per ₹100 is 0/);
  assert.match(counterNotes(base, { amount: 50, pointsAwarded: false })[0], /₹100/);
  assert.match(counterNotes(base, { amount: 500, pointsAwarded: false })[0], /could not be added/);
  assert.ok(!counterNotes(base, { amount: 500, pointsAwarded: true }).some((n) => /points/i.test(n) && /No |could not/.test(n)));
});

test("bug 4: restaurants start with loyalty on; award errors are logged, not swallowed", () => {
  assert.match(readFileSync("lib/new-owner.ts", "utf8"), /autoFeedback: true, autoBirthday: true, loyaltyEnabled: true/);
  const ingest = readFileSync("lib/ingest-events.ts", "utf8");
  assert.doesNotMatch(ingest, /awardForVisit\([^)]*\)\.catch\(\(\) => null\)/);
  assert.match(ingest, /Points for a bill failed/);
});

test("bug 5: the counter says when the rating request goes", () => {
  assert.match(counterNotes(base, { amount: 500, pointsAwarded: true }).join(" "), /1–3 hours after the bill/);
  assert.match(counterNotes({ ...base, autoFeedback: false }, { amount: 500, pointsAwarded: true }).join(" "), /rating loop is off/);
});

test("bug 6: new managers get the manager_welcome template", () => {
  const def = WA_TEMPLATE_DEFS.find((d) => d.key === "manager_welcome");
  assert.ok(def);
  assert.equal(def!.category, "UTILITY");
  assert.equal(def!.audience, "owner");
  assert.equal(templateName("manager_welcome", "en"), "loopdesk_manager_welcome");
  for (const body of Object.values(def!.bodies)) assert.match(body!, /add Priya 9876543210/);
  const team = readFileSync("app/api/team/route.ts", "utf8");
  assert.match(team, /templateKey: "manager_welcome"/);
  assert.match(team, /welcomed/);
});
