import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOOL_TEMPLATE_PREFIX, WA_TOOLS, checkToolMessage } from "../lib/hub/tool-whatsapp";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("Regulars retest 27 Nov: Regulars sends through the hub from the bundle's one number", () => {
  assert.equal(WA_TOOLS.regulars, "REGULARS");
  assert.equal(TOOL_TEMPLATE_PREFIX.REGULARS, "loopdesk_");
  // Regulars' welcome / consent texts and loopdesk_ templates are accepted.
  assert.equal(checkToolMessage({ to: "+91 70870 64400", message: { type: "text", text: { body: "Dhanyavaad!" } } }).to, "917087064400");
  assert.equal(checkToolMessage({ to: "917087064400", message: { type: "template", template: { name: "loopdesk_offer", language: { code: "hi" }, components: [] } } }).templateName, "loopdesk_offer");
});

test("bundle with Regulars: customer messages (QR joins included) are passed on to Regulars", () => {
  const hook = read("app/api/webhook/whatsapp/route.ts");
  const at = hook.indexOf("if (regularsTakesInbound(business)) {");
  assert.ok(at > 0, "webhook checks regularsTakesInbound");
  // After the other tools, before Loopdesk's own customer handling.
  assert.ok(hook.indexOf("inboundTool(business.id") < at && at < hook.indexOf("const messageType = classifyMessageType"));
  // The QR join code is shared with Regulars at set-up, so its QR routes here.
  assert.match(read("lib/hub/provision.ts"), /joinCode: tool === "REGULARS"/);
  // Meta's code reaches the tool so it can fall back to an older template.
  assert.match(read("app/api/hub/tools/[tool]/whatsapp/send/route.ts"), /metaCode/);
});
