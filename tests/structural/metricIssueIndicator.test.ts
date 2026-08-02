import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TABLE_PATH = fileURLToPath(new URL("../../src/components/performance/PerformanceTable.tsx", import.meta.url));
const INDICATOR_PATH = fileURLToPath(new URL("../../src/components/performance/MetricIssueIndicator.tsx", import.meta.url));

test("the issue indicator is only rendered when hasAdditionalExplanation says there is more detail", () => {
  const source = readFileSync(TABLE_PATH, "utf8");
  assert.ok(
    /\{showIssueIndicator && cell\.reason && <MetricIssueIndicator/.test(source),
    "MetricIssueIndicator must be gated on showIssueIndicator (derived from hasAdditionalExplanation), not rendered unconditionally",
  );
  assert.ok(source.includes("hasAdditionalExplanation(cell.reason, inlineLabel, isValueBearing)"));
});

test("no long diagnostic text (cell.reason) is ever rendered directly inside the metric row's value/label spans", () => {
  const source = readFileSync(TABLE_PATH, "utf8");
  // The only two things allowed inline are the formatted value and the
  // short inlineLabel — cell.reason itself must only ever reach
  // MetricIssueIndicator's `message` prop, never a rendered text node
  // in metric-row-value/metric-row-label.
  assert.ok(!/metric-row-value">\{cell\.reason/.test(source), "cell.reason must not render directly in metric-row-value");
  assert.ok(!source.includes("title={displayText}"), "the old native-tooltip pattern showing the long reason must be removed");
  const metricRowValueBlock = source.match(/<span className="metric-row-value">[\s\S]*?<\/span>/);
  assert.ok(metricRowValueBlock, "expected a metric-row-value span");
  assert.ok(!metricRowValueBlock![0].includes("cell.reason"), "metric-row-value must never reference cell.reason directly");
});

test("MetricIssueIndicator passes the exact message into the tooltip text node", () => {
  const source = readFileSync(INDICATOR_PATH, "utf8");
  assert.ok(/metric-issue-tooltip-text">\{message\}/.test(source));
});

test("the Copy button copies the exact message to the clipboard and shows a Copied confirmation", () => {
  const source = readFileSync(INDICATOR_PATH, "utf8");
  assert.ok(source.includes("navigator.clipboard.writeText(message)"));
  assert.ok(/\{copied \? "Copied" : "Copy"\}/.test(source));
});

test("the trigger is a real button (keyboard-focusable) and opens the tooltip on focus, not only hover", () => {
  const source = readFileSync(INDICATOR_PATH, "utf8");
  assert.ok(/<button[\s\S]{0,200}className="metric-issue-trigger"/.test(source));
  const triggerBlock = source.match(/<button[\s\S]*?className="metric-issue-trigger"[\s\S]*?<\/button>/);
  assert.ok(triggerBlock, "expected the trigger button block");
  assert.ok(triggerBlock![0].includes("onFocus={openTooltip}"), "focus must open the tooltip, not only mouse hover");
  assert.ok(triggerBlock![0].includes("aria-label="), "the trigger must have an aria-label");
});

test("the tooltip uses role=tooltip for accessibility", () => {
  const source = readFileSync(INDICATOR_PATH, "utf8");
  assert.ok(source.includes('role="tooltip"'));
});
