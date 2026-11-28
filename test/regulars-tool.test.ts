// Loopdesk AI is the hub; Regulars is a tool like Korvo and Loyvexa (Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jwtVerify } from "jose";
import { TOOLS, TOOL_META, planTools } from "../lib/hub/plans";
import { AUDIENCE, ISSUER, signHubToken } from "../lib/hub/tokens";
import { REGULARS_PAGES, businessTools, isRegularsPage, showsRegularsPages, toolsFromProducts } from "../lib/hub/catalog-rules";
import { switcherItems } from "../lib/hub/switcher";

test("Regulars is a connected tool with its own server settings", () => {
  assert.ok(TOOLS.includes("REGULARS"));
  assert.equal(TOOL_META.REGULARS.apiEnv, "REGULARS_API_URL");
  assert.equal(TOOL_META.REGULARS.appEnv, "REGULARS_APP_URL");
  assert.equal(TOOL_META.REGULARS.secretEnv, "HUB_SECRET_REGULARS");
  assert.equal(TOOL_META.REGULARS.ownerLogin, true);
  assert.equal(AUDIENCE.REGULARS, "regulars");
  const provision = readFileSync("lib/hub/provision.ts", "utf8");
  assert.match(provision, /REGULARS: "\/api\/hub\/provision"/);
  const open = readFileSync("app/api/hub/open/[tool]/route.ts", "utf8");
  assert.match(open, /regulars: "REGULARS"/);
});

test("Regulars is only set up for bundles that include it", () => {
  const regulars = { connect: "AUTO", hubTool: "REGULARS" };
  const korvo = { connect: "AUTO", hubTool: "KORVO" };
  assert.deepEqual(toolsFromProducts([regulars, korvo]), ["REGULARS", "KORVO"]);
  assert.deepEqual(toolsFromProducts([korvo]), ["KORVO"]);
  // A row not yet switched by ensureCatalog() (still HUB) sets nothing up.
  assert.deepEqual(toolsFromProducts([{ connect: "HUB", hubTool: null }, korvo]), ["KORVO"]);
  assert.deepEqual(businessTools({ customBundleId: "b1", bundleTools: "KORVO,LOYVEXA", frontDeskPlan: null }), ["KORVO", "LOYVEXA"]);
  // Built-in Front Desk plans don't get a separate Regulars account.
  for (const plan of ["ANSWER", "ANSWER_RETURN", "GROW"]) assert.ok(!planTools(plan).includes("REGULARS"));
});

test("bundles are no longer forced to include Regulars", () => {
  const catalog = readFileSync("lib/hub/catalog.ts", "utf8");
  assert.doesNotMatch(catalog, /withHub/);
  assert.doesNotMatch(catalog, /connect: "HUB"/);
  for (const f of ["app/api/admin/catalog/bundles/route.ts", "app/api/admin/catalog/bundles/[id]/route.ts"]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /withHub/, f);
  }
});

test("Regulars pages: which paths count", () => {
  for (const p of REGULARS_PAGES) assert.ok(isRegularsPage(p), p);
  assert.ok(isRegularsPage("/dashboard/customers/abc123"));
  assert.ok(isRegularsPage("/dashboard/offers/new"));
  // Loopdesk's own pages stay for everyone.
  for (const p of ["/dashboard", "/dashboard/inbox", "/dashboard/growth", "/dashboard/team", "/dashboard/billing", "/dashboard/settings"]) {
    assert.ok(!isRegularsPage(p), p);
  }
  assert.ok(!isRegularsPage("/dashboard/customersX"));
  assert.ok(!isRegularsPage(null));
});

test("who sees the Regulars pages in Loopdesk", () => {
  // Built-in plans and clients without a bundle: unchanged.
  assert.equal(showsRegularsPages({ customBundleId: null }, false), true);
  // Custom bundle: only when Regulars is ticked.
  assert.equal(showsRegularsPages({ customBundleId: "b1" }, true), true);
  assert.equal(showsRegularsPages({ customBundleId: "b1" }, false), false);
});

test("the pages are hidden from the menu and blocked by address", () => {
  const nav = readFileSync("components/dashboard-nav.tsx", "utf8");
  assert.match(nav, /regularsPages \|\| !isRegularsPage\(l\.href\)/);
  const layout = readFileSync("app/dashboard/layout.tsx", "utf8");
  assert.match(layout, /isRegularsPage\(headers\(\)\.get\("x-pathname"\)\)/);
  assert.match(layout, /no-regulars/);
  const mw = readFileSync("middleware.ts", "utf8");
  assert.match(mw, /x-pathname/);
});

test("the tool switcher shows Regulars (Loopdesk's own pages), enabled only when it's in the plan", () => {
  const off = switcherItems(["KORVO"]).find((i) => i.id === "regulars");
  const on = switcherItems(["REGULARS"]).find((i) => i.id === "regulars");
  assert.ok(off && on);
  assert.equal(off!.enabled, false);
  assert.equal(on!.enabled, true);
  assert.equal(on!.href, "/dashboard/customers");
  assert.equal(on!.external, false);
});

test("tokens for Regulars match what the Regulars server checks", async () => {
  const secret = "s".repeat(40);
  process.env.HUB_SECRET_REGULARS = secret;
  try {
    const token = await signHubToken("REGULARS", "sso", "hub-biz-1", { acct: "rg-1", next: "/dashboard/offers" });
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { issuer: "regulars-hub", audience: "regulars", maxTokenAge: "120s" });
    assert.equal(ISSUER, "regulars-hub");
    assert.equal(payload.sub, "hub-biz-1");
    assert.equal(payload.purpose, "sso");
    assert.equal(payload.acct, "rg-1");
    assert.ok(payload.jti);
  } finally {
    delete process.env.HUB_SECRET_REGULARS;
  }
});
