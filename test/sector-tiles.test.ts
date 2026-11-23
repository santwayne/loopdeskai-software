// Industry-wise tiles and India-first signup (Nov 2026 pending list).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { productFitsSector, sectorShowsDealerTools, toolsForSector } from "../lib/hub/catalog-rules";
import type { Tool } from "../lib/hub/plans";

const ALL: Tool[] = ["WAYNERING", "FIELD_SERVICE", "GMB", "VIDEO", "KORVO", "LOYVEXA"];

test("a spa/salon, gym, clinic, restaurant or home-services business never sees Korvo or Loyvexa", () => {
  for (const sector of ["SALON", "GYM", "CLINIC", "RESTAURANT", "HOME_SERVICES", "salon"]) {
    assert.deepEqual(toolsForSector(ALL, sector), ["WAYNERING", "FIELD_SERVICE", "GMB", "VIDEO"], sector);
    assert.equal(productFitsSector("korvo", sector), false);
    assert.equal(productFitsSector("loyvexa", sector), false);
    assert.equal(productFitsSector("gmb", sector), true);
  }
});

test("manufacturers, retail and other keep the dealer tools", () => {
  for (const sector of ["MANUFACTURER", "RETAIL", "OTHER"]) {
    assert.equal(sectorShowsDealerTools(sector), true);
    assert.deepEqual(toolsForSector(ALL, sector), ALL);
  }
});

test("an unknown or missing sector hides dealer tools (safer default)", () => {
  assert.deepEqual(toolsForSector(ALL, null), ["WAYNERING", "FIELD_SERVICE", "GMB", "VIDEO"]);
});

test("signup opens on India / INR unless ?country=CA", () => {
  const page = readFileSync("app/signup/page.tsx", "utf8");
  assert.match(page, /country\?\.toUpperCase\(\) === "CA" \? "CA" : "IN"/);
  const form = readFileSync("components/forms/bundle-signup-form.tsx", "utf8");
  assert.match(form, /\["IN", "CA"\] as const/);
});
