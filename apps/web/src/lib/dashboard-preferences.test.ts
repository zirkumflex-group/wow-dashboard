import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DASHBOARD_PREFERENCES,
  normalizeDashboardPreferences,
} from "./dashboard-preferences";

test("normalizeDashboardPreferences supplies safe defaults for invalid data", () => {
  assert.deepEqual(normalizeDashboardPreferences(null), DEFAULT_DASHBOARD_PREFERENCES);
  assert.deepEqual(
    normalizeDashboardPreferences({
      hideBelow90: "yes",
      minItemLevel: "not-a-number",
      hideNoSnapshot: 1,
    }),
    DEFAULT_DASHBOARD_PREFERENCES,
  );
});

test("normalizeDashboardPreferences clamps numeric item-level filters", () => {
  assert.deepEqual(
    normalizeDashboardPreferences({
      hideBelow90: true,
      minItemLevel: 1200,
      hideNoSnapshot: true,
    }),
    { hideBelow90: true, minItemLevel: 1000, hideNoSnapshot: true },
  );
});
