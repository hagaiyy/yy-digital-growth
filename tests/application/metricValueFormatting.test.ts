import { test } from "node:test";
import assert from "node:assert/strict";

import { formatMetricDisplayValue, stripMillisecondLabelSuffix } from "@/application/performance/metricValueFormatting";

test("normal value: converts milliseconds to seconds with one decimal", () => {
  assert.equal(formatMetricDisplayValue(10627, "milliseconds"), "10.6 s");
  assert.equal(formatMetricDisplayValue(2858905, "milliseconds"), "2858.9 s");
});

test("zero: a real zero millisecond value is shown as 0.0 s, not blank", () => {
  assert.equal(formatMetricDisplayValue(0, "milliseconds"), "0.0 s");
});

test("null: never shown as zero, distinct sentinel instead", () => {
  const result = formatMetricDisplayValue(null, "milliseconds");
  assert.equal(result, "—");
  assert.notEqual(result, "0.0 s");
});

test("empty state: a metric with status 'empty' always has value null upstream, never rendered as 0.0 s", () => {
  // This codebase's own invariant: "empty" status always carries value
  // null (Meta accepted the request but returned nothing) — never a
  // fabricated zero. The formatter must honor that for ms metrics too.
  const emptyMetricValue: number | null = null;
  assert.equal(formatMetricDisplayValue(emptyMetricValue, "milliseconds"), "—");
});

test("unsupported state: same invariant — value null, never 0.0 s", () => {
  const unsupportedMetricValue: number | null = null;
  assert.equal(formatMetricDisplayValue(unsupportedMetricValue, "milliseconds"), "—");
});

test("non-millisecond metric is not converted", () => {
  assert.equal(formatMetricDisplayValue(5, "count"), "5");
  assert.equal(formatMetricDisplayValue(61.7, "percentage"), "61.7 %");
});

test("stripMillisecondLabelSuffix removes a trailing ' Ms' only for millisecond-unit metrics", () => {
  assert.equal(stripMillisecondLabelSuffix("Average Watch Time Ms", "milliseconds"), "Average Watch Time");
  assert.equal(stripMillisecondLabelSuffix("Total Watch Time Ms", "milliseconds"), "Total Watch Time");
  assert.equal(stripMillisecondLabelSuffix("Some Other Ms", "count"), "Some Other Ms");
});
