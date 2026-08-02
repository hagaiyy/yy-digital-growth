import { test } from "node:test";
import assert from "node:assert/strict";

import { hasAdditionalExplanation, resolveInlineStatusLabel } from "@/application/performance/metricIssueDisplay";

test("resolveInlineStatusLabel overrides plays/facebookViews/crosspostedViews to the exact required phrase", () => {
  assert.equal(resolveInlineStatusLabel("plays", "deprecated"), "Not available through current API");
  assert.equal(resolveInlineStatusLabel("facebookViews", "noFacebookDistribution"), "Not available through current API");
  assert.equal(resolveInlineStatusLabel("crosspostedViews", "notCrossposted"), "Not available through current API");
});

test("resolveInlineStatusLabel falls back to the generic per-status label for every other metric", () => {
  assert.equal(resolveInlineStatusLabel("shares", "empty"), "No data returned");
  assert.equal(resolveInlineStatusLabel("postImpressions", "deprecated"), "Deprecated");
  assert.equal(resolveInlineStatusLabel("likes", "available"), "Available");
});

test("hasAdditionalExplanation is false when there is no reason at all (normal healthy metric)", () => {
  assert.equal(hasAdditionalExplanation(undefined, "Available"), false);
});

test("hasAdditionalExplanation is false when the reason is identical to the inline label (nothing extra to reveal)", () => {
  assert.equal(hasAdditionalExplanation("Not available through current API", "Not available through current API"), false);
});

test("hasAdditionalExplanation is true when a longer explanation exists beyond the short inline label", () => {
  const longExplanation =
    "Live production response (imagePost/linkPost, 2026-08-01): field accepted, no error, but no value returned for either tested post. Not found in current v26.0 post-metrics documentation — may be a legacy name Meta still accepts but rarely populates.";
  assert.equal(hasAdditionalExplanation(longExplanation, "No data returned"), true);
});
