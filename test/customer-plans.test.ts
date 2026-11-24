import { test } from "node:test";
import assert from "node:assert/strict";
import { ONLINE_PAYMENTS, bundleKey, customerPlans, parsePlanKey, planLabel, type BundleRow } from "../lib/hub/customer-plans";

const product = (name: string, connect = "AUTO", sortOrder = 50) => ({ product: { name, description: null, connect, active: true, sortOrder } });
const bundle = (over: Partial<BundleRow> = {}): BundleRow => ({
  id: "b1", name: "Distributor Pack", description: null, priceInr: 14999, priceCad: null, interval: "MONTHLY",
  growthManager: false, active: true, showToCustomers: true,
  items: [product("Regulars", "HUB", 0), product("Loyvexa", "AUTO", 70), product("Korvo", "AUTO", 60)],
  ...over,
});

test("customers see the built-in plans and our bundles (Korvo + Loyvexa)", () => {
  const plans = customerPlans([bundle(), bundle({ id: "b2", name: "Hidden", showToCustomers: false }), bundle({ id: "b3", name: "Off", active: false })]);
  assert.deepEqual(plans.map((p) => p.key), ["ANSWER", "ANSWER_RETURN", "GROW", "bundle:b1"]);
  const pack = plans.find((p) => p.custom)!;
  assert.equal(pack.tagline, "Korvo + Loyvexa"); // hub left out, in catalog order
  assert.deepEqual(pack.price, { INR: 14999, CAD: null });
  assert.equal(pack.per, "month");
  assert.equal(customerPlans([bundle({ interval: "YEARLY" })]).at(-1)!.per, "year");
});

test("plan keys are a built-in plan or a bundle", () => {
  assert.deepEqual(parsePlanKey("grow"), { builtIn: "GROW" });
  assert.deepEqual(parsePlanKey(bundleKey("abc")), { bundleId: "abc" });
  assert.equal(parsePlanKey("bundle:"), null);
  assert.equal(parsePlanKey("PLATINUM"), null);
  assert.equal(parsePlanKey(null), null);
  const plans = customerPlans([bundle()]);
  assert.equal(planLabel("bundle:b1", plans), "Distributor Pack");
  assert.equal(planLabel("bundle:gone", plans), "A bundle that's no longer offered");
  assert.equal(planLabel(null, plans), null);
});

test("online payment is off unless switched on", () => {
  assert.equal(ONLINE_PAYMENTS, false);
});
