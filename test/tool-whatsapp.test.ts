import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOptInBody, checkToolMessage, isOtpTemplate, phoneVariants, pickInboundOwner, toolTemplatesFrom, ToolWaError, waDigits } from "../lib/hub/tool-whatsapp";

test("a tool may send plain text or a named template, to one clean number", () => {
  const t = checkToolMessage({ to: "+91 98140-00101", message: { type: "text", text: { body: "Aapke 800 points hain" } } });
  assert.equal(t.to, "919814000101"); assert.equal(t.kind, "text");
  const tpl = checkToolMessage({ to: "919814000101", message: { type: "template", template: { name: "loyvexa_otp", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "123456" }] }] } } });
  assert.equal(tpl.templateName, "loyvexa_otp");
  assert.deepEqual(Object.keys(tpl.message), ["type", "template"]); // nothing else (no "to", no sender) passes through
  for (const bad of [
    { to: "123", message: { type: "text", text: { body: "x" } } },
    { to: "919814000101", message: { type: "image", image: { link: "x" } } },
    { to: "919814000101", message: { type: "template", template: { name: "Bad Name!" } } },
    { to: "919814000101", message: { type: "text", text: { body: "  " } } },
  ]) assert.throws(() => checkToolMessage(bad), ToolWaError);
});

test("STOP blocks everything from a tool except OTP codes", () => {
  assert.equal(isOtpTemplate("loyvexa_otp"), true);
  assert.equal(isOtpTemplate("loyvexa_ai_slab"), false);
  assert.equal(isOtpTemplate(null), false);
  assert.equal(waDigits("+91 (981) 400-0101"), "919814000101");
});

test("a reply goes to whoever wrote to that person last: the tool or Regulars", () => {
  const t = (s: string) => new Date(`2026-11-20T${s}:00Z`);
  assert.equal(pickInboundOwner({ lastOutboundAt: t("10:00"), createdAt: t("09:00") }, null), true);
  assert.equal(pickInboundOwner({ lastOutboundAt: t("10:00"), createdAt: t("09:00") }, t("09:30")), true);
  assert.equal(pickInboundOwner({ lastOutboundAt: t("10:00"), createdAt: t("09:00") }, t("11:00")), false);
});

test("opt-in sync: START from a tool clears STOP for that number (Loyvexa testing report 2 #1)", () => {
  assert.deepEqual(checkOptInBody({ to: "+91 98140-00101", optIn: true }), { to: "919814000101", optIn: true });
  assert.deepEqual(checkOptInBody({ to: "919814000101", optIn: false }), { to: "919814000101", optIn: false });
  for (const bad of [{ to: "123", optIn: true }, { to: "919814000101" }, { to: "919814000101", optIn: "yes" }, null]) assert.throws(() => checkOptInBody(bad), ToolWaError);
  const v = phoneVariants("919814000101");
  for (const x of ["919814000101", "+919814000101", "9814000101", "09814000101"]) assert.ok(v.includes(x), x);
  assert.deepEqual(phoneVariants("14165550101").sort(), ["+14165550101", "14165550101"]);
});

test("templates for a tool: only its own prefix, with status and param count (Loyvexa testing report 2 #6)", () => {
  const out = toolTemplatesFrom([
    { name: "loyvexa_scheme_bonus", language: "en", status: "PENDING", category: "UTILITY", components: [{ type: "BODY", text: "Hi {{1}}, {{2}} points" }] },
    { name: "loyvexa_ai_slab", language: "hi", status: "approved", components: [{ type: "HEADER", text: "x" }, { type: "BODY", text: "{{1}} {{2}} {{3}} {{1}}" }] },
    { name: "loopdesk_offer_en", language: "en", status: "APPROVED" },
    { name: "sehat_patient_welcome", language: "en", status: "APPROVED" },
  ], "loyvexa_");
  assert.deepEqual(out.map((t) => t.name), ["loyvexa_scheme_bonus", "loyvexa_ai_slab"]);
  assert.equal(out[0].status, "PENDING"); assert.equal(out[0].params, 2);
  assert.equal(out[1].status, "APPROVED"); assert.equal(out[1].params, 3); assert.equal(out[1].category, null);
});
