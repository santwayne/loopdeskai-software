import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS, TOOL_META } from "../lib/hub/plans";
import { AUDIENCE } from "../lib/hub/tokens";
import { PATH } from "../lib/hub/provision";
import { BUILT_IN_PRODUCTS, toolsFromProducts } from "../lib/hub/catalog-rules";
import { switcherItems } from "../lib/hub/switcher";

// Must match the Wayne Ads server: aud "wayne-ads" (HUB_AUDIENCE), POST /api/hub/provision, /sso.
test("Wayne Ads Manager is a Loopdesk tool like the others", () => {
  assert.ok(TOOLS.includes("WAYNE_ADS"));
  assert.equal(AUDIENCE.WAYNE_ADS, "wayne-ads");
  assert.equal(PATH.WAYNE_ADS, "/api/hub/provision");
  assert.equal(TOOL_META.WAYNE_ADS.secretEnv, "HUB_SECRET_WAYNE_ADS");
  assert.equal(TOOL_META.WAYNE_ADS.apiEnv, "WAYNE_ADS_API_URL");
  assert.equal(TOOL_META.WAYNE_ADS.appEnv, "WAYNE_ADS_APP_URL");
  assert.equal(TOOL_META.WAYNE_ADS.pages?.home, "/");
  const p = BUILT_IN_PRODUCTS.find((x) => x.key === "wayne-ads");
  assert.equal(p?.connect, "AUTO"); assert.equal(p?.hubTool, "WAYNE_ADS");
  assert.deepEqual(toolsFromProducts([{ connect: "AUTO", hubTool: "WAYNE_ADS" }, { connect: "AUTO", hubTool: "WAYNERING" }]), ["WAYNERING", "WAYNE_ADS"]);
  const item = switcherItems(["WAYNE_ADS"]).find((i) => i.id === "ads-manager");
  assert.equal(item?.enabled, true); assert.equal(item?.href, "/api/hub/open/wayne-ads");
  assert.equal(switcherItems([]).find((i) => i.id === "ads-manager")?.enabled, false);
});
