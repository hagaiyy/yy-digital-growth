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

test("Instagram Reel keeps untested and unsupported metrics visible (not excluded)", () => {
  const metrics = getRelevantMetricsForContentType("instagram", "reel");
  const plays = metrics.find((m) => m.internalMetric === "plays");
  assert.ok(plays, "unsupported metrics stay in the relevant list, just with their real status");
  assert.equal(plays?.canonicalStatus, "unsupported");
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
