import { test } from "node:test";
import assert from "node:assert/strict";

import {
  planInstagramAccountInsightsRequest,
  planInstagramMediaInsightsRequest,
} from "@/application/connectors/instagram/insightsRequestPlanner";

const GRANTED = ["instagram_business_basic", "instagram_business_manage_insights"];

test("reel plan requests only live-confirmed metrics and excludes invalid-for-type ones", () => {
  const plan = planInstagramMediaInsightsRequest({
    accountType: "creator",
    contentType: "reel",
    grantedPermissions: GRANTED,
  });

  const requested = plan.metricsToRequest.map((m) => m.providerMetric);
  assert.ok(requested.includes("views"));
  assert.ok(requested.includes("ig_reels_avg_watch_time"));
  assert.ok(!requested.includes("impressions"), "deprecated/invalid metrics must never be requested");
  assert.ok(!requested.includes("follows"), "follows was confirmed rejected for reel content");

  const excluded = plan.excludedMetrics.map((m) => m.providerMetric);
  assert.ok(excluded.includes("impressions"));
  assert.ok(excluded.includes("follows"));

  const free = plan.freeMetricsFromDiscovery.map((m) => m.providerMetric);
  assert.deepEqual(free.sort(), ["comments_count", "like_count"]);
});

test("carousel plan includes follows/profile_activity, which are excluded for reel", () => {
  const plan = planInstagramMediaInsightsRequest({
    accountType: "creator",
    contentType: "carousel",
    grantedPermissions: GRANTED,
  });
  const requested = plan.metricsToRequest.map((m) => m.providerMetric);
  assert.ok(requested.includes("follows"));
  assert.ok(requested.includes("profile_activity"));
});

test("a content type never sends the same metric list as another content type", () => {
  const reelPlan = planInstagramMediaInsightsRequest({
    accountType: "creator",
    contentType: "reel",
    grantedPermissions: GRANTED,
  });
  const carouselPlan = planInstagramMediaInsightsRequest({
    accountType: "creator",
    contentType: "carousel",
    grantedPermissions: GRANTED,
  });
  const reelMetrics = reelPlan.metricsToRequest.map((m) => m.providerMetric).sort();
  const carouselMetrics = carouselPlan.metricsToRequest.map((m) => m.providerMetric).sort();
  assert.notDeepEqual(reelMetrics, carouselMetrics);
});

test("imageStory plan requests every live-confirmed metric and excludes only proven-invalid/deprecated ones", () => {
  const plan = planInstagramMediaInsightsRequest({
    accountType: "creator",
    contentType: "imageStory",
    grantedPermissions: GRANTED,
  });
  // Live-proven 2026-08-03 against a real IMAGE Story — see
  // metricCapabilityRegistry.ts's imageStory section.
  const requested = plan.metricsToRequest.map((m) => m.providerMetric);
  assert.ok(requested.includes("views"));
  assert.ok(requested.includes("navigation"));
  assert.ok(requested.includes("follows"));
  // facebook_views stays in the live-request path (re-verified every
  // import, not a permanent exclusion) even though this Story had no
  // Facebook distribution.
  assert.ok(requested.includes("facebook_views"));

  const excluded = plan.excludedMetrics.map((m) => m.providerMetric);
  assert.ok(excluded.includes("exits"), "exits is confirmed deprecated, superseded by navigation");
  assert.ok(excluded.includes("taps_forward"));
  assert.ok(excluded.includes("taps_back"));
  assert.ok(excluded.includes("link_clicks"), "link_clicks is confirmed invalidForContentType for Story");
  assert.ok(excluded.includes("total_views"));
  assert.ok(excluded.includes("impressions"));
  assert.ok(excluded.includes("reposts"), "reposts is confirmed invalidForApiModel and must never be re-requested");
});

test("videoStory plan is entirely untested but every candidate is still requested — untested must never disable the planner", () => {
  const plan = planInstagramMediaInsightsRequest({
    accountType: "creator",
    contentType: "videoStory",
    grantedPermissions: GRANTED,
  });
  // Nothing has been live-tested for videoStory yet, so nothing may be
  // pre-excluded — "untested" is not in NEVER_REQUEST_STATUSES.
  assert.equal(plan.excludedMetrics.length, 0, "an untested metric must never be pre-excluded from the request");
  assert.ok(plan.metricsToRequest.length > 0);
  assert.ok(plan.metricsToRequest.every((m) => m.status === "untested"));
  const requested = plan.metricsToRequest.map((m) => m.providerMetric);
  // Same provider metric names as imageStory (Meta's docs name no
  // video-specific Story metric), but independently untested.
  assert.ok(requested.includes("views"));
  assert.ok(requested.includes("navigation"));
  assert.ok(requested.includes("facebook_views"));
  assert.ok(requested.includes("reposts"), "even reposts (proven invalidForApiModel for imageStory) starts untested for videoStory, never copied over");
});

test("imageStory and videoStory plans never share a proven status for the same provider metric", () => {
  const imagePlan = planInstagramMediaInsightsRequest({ accountType: "creator", contentType: "imageStory", grantedPermissions: GRANTED });
  const videoPlan = planInstagramMediaInsightsRequest({ accountType: "creator", contentType: "videoStory", grantedPermissions: GRANTED });
  const imageViews = imagePlan.metricsToRequest.find((m) => m.providerMetric === "views");
  const videoViews = videoPlan.metricsToRequest.find((m) => m.providerMetric === "views");
  assert.equal(imageViews?.status, "supported");
  assert.equal(videoViews?.status, "untested");
});

test("missing a required permission excludes every candidate with reason permissionRequired", () => {
  const plan = planInstagramMediaInsightsRequest({
    accountType: "creator",
    contentType: "reel",
    grantedPermissions: [],
  });
  assert.equal(plan.metricsToRequest.length, 0);
  assert.ok(plan.excludedMetrics.length > 0);
  assert.ok(plan.excludedMetrics.every((m) => m.reason === "permissionRequired"));
});

test("account plan groups day-period aggregates separately from lifetime demographics", () => {
  const plan = planInstagramAccountInsightsRequest({ accountType: "creator", grantedPermissions: GRANTED });
  const dayGroup = plan.requestGroups.find((g) => g.period === "day");
  const demographicsGroup = plan.requestGroups.find((g) => g.breakdown === "age");

  assert.ok(dayGroup, "expected a day-period aggregate group");
  assert.ok(demographicsGroup, "expected a lifetime demographics group");
  assert.notEqual(dayGroup, demographicsGroup);
  assert.ok(dayGroup!.requiresDateRange);
  assert.ok(!demographicsGroup!.requiresDateRange, "demographics use timeframe, not a computed date range");

  // engaged_audience_demographics/reached_audience_demographics were
  // confirmed rejected in this task's own live production run and are
  // now excluded outright — only follower_demographics, which was
  // confirmed supported live, remains in the requested group.
  const demographicMetrics = demographicsGroup!.metrics.map((m) => m.providerMetric);
  assert.ok(demographicMetrics.includes("follower_demographics"));
  assert.ok(!demographicMetrics.includes("engaged_audience_demographics"));
});

test("account plan excludes deprecated metrics like profile_views and website_clicks, and metrics confirmed rejected live like engaged/reached audience demographics", () => {
  const plan = planInstagramAccountInsightsRequest({ accountType: "creator", grantedPermissions: GRANTED });
  const excludedNames = plan.excludedMetrics.map((m) => m.providerMetric);
  assert.ok(excludedNames.includes("profile_views"));
  assert.ok(excludedNames.includes("engaged_audience_demographics"));
  assert.ok(excludedNames.includes("reached_audience_demographics"));
  assert.ok(excludedNames.includes("website_clicks"));
  const allGroupedMetrics = plan.requestGroups.flatMap((g) => g.metrics.map((m) => m.providerMetric));
  assert.ok(!allGroupedMetrics.includes("profile_views"));
});
