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

test("story plan excludes nothing outright except explicitly deprecated legacy metrics, and everything is untested", () => {
  const plan = planInstagramMediaInsightsRequest({
    accountType: "creator",
    contentType: "story",
    grantedPermissions: GRANTED,
  });
  assert.ok(plan.metricsToRequest.every((m) => m.status === "untested"));
  const excludedReasons = plan.excludedMetrics.map((m) => m.reason);
  assert.ok(excludedReasons.every((reason) => reason === "deprecated"));
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

  const demographicMetrics = demographicsGroup!.metrics.map((m) => m.providerMetric);
  assert.ok(demographicMetrics.includes("follower_demographics"));
  assert.ok(demographicMetrics.includes("engaged_audience_demographics"));
});

test("account plan excludes deprecated metrics like profile_views and website_clicks", () => {
  const plan = planInstagramAccountInsightsRequest({ accountType: "creator", grantedPermissions: GRANTED });
  const excludedNames = plan.excludedMetrics.map((m) => m.providerMetric);
  assert.ok(excludedNames.includes("profile_views"));
  assert.ok(excludedNames.includes("website_clicks"));
  const allGroupedMetrics = plan.requestGroups.flatMap((g) => g.metrics.map((m) => m.providerMetric));
  assert.ok(!allGroupedMetrics.includes("profile_views"));
});
