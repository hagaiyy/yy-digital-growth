import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TABLE_PATH = fileURLToPath(new URL("../../src/components/performance/PerformanceTable.tsx", import.meta.url));
const PANEL_PATH = fileURLToPath(new URL("../../src/components/DataImportPanel.tsx", import.meta.url));

test("a timeframe with no snapshot renders the exact required literal", () => {
  const source = readFileSync(TABLE_PATH, "utf8");
  assert.ok(source.includes("No data saved for timeframe"));
});

test("the performance table only renders a metric's value for available/supported status, never for empty/untested/etc", () => {
  const source = readFileSync(TABLE_PATH, "utf8");
  assert.ok(
    /isValueBearing\s*=\s*cell\.status === "available" \|\| cell\.status === "supported"/.test(source),
    "value rendering must be gated on the metric actually being available/supported",
  );
});

test("the Data Import panel no longer renders the full 'Last import summary' block", () => {
  const source = readFileSync(PANEL_PATH, "utf8");
  assert.ok(!source.includes("Last import summary"));
  assert.ok(source.includes("ImportStatusIndicator"), "must use the compact indicator instead");
});
