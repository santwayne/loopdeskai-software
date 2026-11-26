import { test } from "node:test";
import assert from "node:assert/strict";
import { checkToolMessage, defaultInboundOwner, ToolWaError, WA_TOOLS } from "../lib/hub/tool-whatsapp";
import { TOOLS, TOOL_META } from "../lib/hub/plans";
import { AUDIENCE } from "../lib/hub/tokens";
import { PATH } from "../lib/hub/provision";
import { BUILT_IN_PRODUCTS, toolsFromProducts } from "../lib/hub/catalog-rules";
import { switcherItems } from "../lib/hub/switcher";
import { lintToolTemplates, toolMetaTemplates } from "../lib/hub/tool-templates";

test("Sehat Saathi is a Loopdesk tool like the others", () => {
  assert.ok(TOOLS.includes("SEHAT_SAATHI"));
  assert.equal(AUDIENCE.SEHAT_SAATHI, "sehat-saathi");
  assert.equal(PATH.SEHAT_SAATHI, "/api/hub/provision");
  assert.equal(TOOL_META.SEHAT_SAATHI.secretEnv, "HUB_SECRET_SEHAT_SAATHI");
  assert.equal(TOOL_META.SEHAT_SAATHI.pages?.home, "/app");
  assert.equal(WA_TOOLS["sehat-saathi"], "SEHAT_SAATHI");
  const p = BUILT_IN_PRODUCTS.find((x) => x.key === "sehat-saathi");
  assert.equal(p?.connect, "AUTO");
  assert.deepEqual(toolsFromProducts([{ connect: "AUTO", hubTool: "SEHAT_SAATHI" }, { connect: "AUTO", hubTool: "WAYNERING" }]), ["WAYNERING", "SEHAT_SAATHI"]);
  const item = switcherItems(["SEHAT_SAATHI"]).find((i) => i.id === "sehat-saathi");
  assert.equal(item?.enabled, true); assert.equal(item?.href, "/api/hub/open/sehat-saathi");
  assert.equal(switcherItems([]).find((i) => i.id === "sehat-saathi")?.enabled, false);
});

test("a hospital's new patient goes to Sehat Saathi; Regulars customers stay with Regulars", () => {
  assert.equal(defaultInboundOwner(["SEHAT_SAATHI"], false), "SEHAT_SAATHI");
  assert.equal(defaultInboundOwner(["SEHAT_SAATHI"], true), null);
  assert.equal(defaultInboundOwner(["LOYVEXA", "WAYNERING"], false), null); // not a hospital: unchanged
});

test("Sehat Saathi may send a catalog button, but nothing else interactive", () => {
  const c = checkToolMessage({ to: "919814000101", message: { type: "interactive", interactive: { type: "catalog_message", body: { text: "Reorder your medicines" }, action: { name: "catalog_message", parameters: {} } } } });
  assert.equal(c.kind, "interactive");
  assert.deepEqual(Object.keys(c.message), ["type", "interactive"]);
  for (const bad of [
    { type: "interactive", interactive: { type: "cta_url", body: { text: "x" }, action: { name: "cta_url", parameters: { url: "https://evil" } } } },
    { type: "interactive", interactive: { type: "catalog_message", body: { text: " " }, action: { name: "catalog_message" } } },
  ]) assert.throws(() => checkToolMessage({ to: "919814000101", message: bad }), ToolWaError);
});

test("Sehat Saathi templates pass Meta's rules, in English, Hindi and Punjabi", () => {
  assert.deepEqual(lintToolTemplates(), []);
  const all = toolMetaTemplates();
  for (const n of ["sehat_patient_welcome", "sehat_patient_checkin", "sehat_family_invite", "sehat_family_weekly_digest", "sehat_refill_reminder"]) {
    assert.deepEqual(all.filter((t) => t.name === n).map((t) => t.language).sort(), ["en", "hi", "pa"]);
  }
  for (const t of all) {
    const vars = new Set(t.components[0].text.match(/\{\{\d+\}\}/g) ?? []).size;
    assert.equal(t.components[0].example.body_text[0].length, vars, `${t.name}/${t.language} example count`);
  }
});
