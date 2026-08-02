import { test } from "node:test";
import assert from "node:assert/strict";

import { getRelevantMetricsForContentType } from "@/application/performance/relevantMetrics";

test("Instagram Reel excludes invalidForContentType metrics like impressions", () => {
  const metrics = getRelevantMetricsForContentType("instagram", "reel");
  const names = metrics.map((m) => m.internalMetric);
  assert.ok(names.includes("likes"));
  assert.ok(names.includes("views"));
  assert.ok(!names.includes("impressions"), "impressions is invalidForContentType for Reel and must be excluded");
});

test("Instagram Reel keeps non-invalidForContentType metrics visible (not excluded)", () => {
  const metrics = getRelevantMetricsForContentType("instagram", "reel");
  // "plays" is proven deprecated (superseded by "views"), not hidden —
  // see metricCapabilityRegistry.ts's 2026-08-02 re-diagnosis.
  const plays = metrics.find((m) => m.internalMetric === "plays");
  assert.ok(plays, "deprecated metrics stay in the relevant list, just with their real status");
  assert.equal(plays?.canonicalStatus, "deprecated");
  assert.equal(plays?.reason, "Not returned for this media — views is available instead.");
});

test("Instagram Reel classifies facebook_views/crossposted_views contextually, not as generic unsupported", () => {
  const metrics = getRelevantMetricsForContentType("instagram", "reel");
  const facebookViews = metrics.find((m) => m.internalMetric === "facebookViews");
  const crosspostedViews = metrics.find((m) => m.internalMetric === "crosspostedViews");
  assert.equal(facebookViews?.canonicalStatus, "noFacebookDistribution");
  assert.equal(crosspostedViews?.canonicalStatus, "notCrossposted");
  assert.ok(facebookViews?.reason);
  assert.ok(crosspostedViews?.reason);
});

test("Facebook imagePost includes likes/comments as available and shares as empty", () => {
  const metrics = getRelevantMetricsForContentType("facebook", "imagePost");
  const likes = metrics.find((m) => m.internalMetric === "likes");
  const shares = metrics.find((m) => m.internalMetric === "shares");
  assert.equal(likes?.canonicalStatus, "available");
  assert.equal(shares?.canonicalStatus, "empty");
});

test("Facebook imagePost excludes video-only metrics like videoViews", () => {
  const metrics = getRelevantMetricsForContentType("facebook", "imagePost");
  assert.ok(!metrics.some((m) => m.internalMetric === "videoViews"));
});

test("Facebook feedVideo includes video-only metrics", () => {
  const metrics = getRelevantMetricsForContentType("facebook", "feedVideo");
  assert.ok(metrics.some((m) => m.internalMetric === "videoViews"));
});

test("never returns a duplicate internalMetric for the same platform+contentType", () => {
  const metrics = getRelevantMetricsForContentType("facebook", "linkPost");
  const names = metrics.map((m) => m.internalMetric);
  assert.equal(names.length, new Set(names).size);
});

test("Pinterest has no registry yet and returns no relevant metrics", () => {
  assert.deepEqual(getRelevantMetricsForContentType("pinterest", "pin"), []);
});
