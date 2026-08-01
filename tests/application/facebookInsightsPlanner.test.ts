import { test } from "node:test";
import assert from "node:assert/strict";

import {
  planFacebookPageInsightsRequest,
  planFacebookPostInsightsRequest,
} from "@/application/connectors/facebook/insightsRequestPlanner";

const GRANTED = ["public_profile", "pages_show_list", "pages_read_engagement", "read_insights"];

test("imagePost plan requests engagement counters via the object endpoint and distribution metrics via /insights", () => {
  const plan = planFacebookPostInsightsRequest({ contentType: "imagePost", grantedPermissions: GRANTED });

  const objectFieldNames = plan.objectFieldMetrics.map((m) => m.providerMetric);
  assert.ok(objectFieldNames.includes("likes.summary(true)"));
  assert.ok(objectFieldNames.includes("comments.summary(true)"));
  assert.ok(objectFieldNames.includes("shares"));
  assert.ok(plan.objectFieldMetrics.every((m) => m.endpoint === "/{post-id}"));

  const insightsNames = plan.insightsMetrics.map((m) => m.providerMetric);
  assert.ok(insightsNames.includes("post_clicks"));
  assert.ok(plan.insightsMetrics.every((m) => m.endpoint === "/{post-id}/insights"));
});

test("deprecated metrics (post_impressions, post_impressions_unique) are excluded, never requested", () => {
  const plan = planFacebookPostInsightsRequest({ contentType: "imagePost", grantedPermissions: GRANTED });
  const insightsNames = plan.insightsMetrics.map((m) => m.providerMetric);
  assert.ok(!insightsNames.includes("post_impressions"));
  assert.ok(!insightsNames.includes("post_impressions_unique"));

  const excludedNames = plan.excludedMetrics.map((m) => m.providerMetric);
  assert.ok(excludedNames.includes("post_impressions"));
  assert.ok(excludedNames.includes("post_impressions_unique"));
  const excludedReasons = plan.excludedMetrics
    .filter((m) => m.providerMetric === "post_impressions")
    .map((m) => m.reason);
  assert.deepEqual(excludedReasons, ["deprecated"]);
});

test("video-specific metrics are only planned for feedVideo/reel, never for a text or image post", () => {
  const videoPlan = planFacebookPostInsightsRequest({ contentType: "feedVideo", grantedPermissions: GRANTED });
  const imagePlan = planFacebookPostInsightsRequest({ contentType: "imagePost", grantedPermissions: GRANTED });

  const videoMetrics = videoPlan.insightsMetrics.map((m) => m.providerMetric);
  assert.ok(videoMetrics.includes("post_video_views"));
  assert.ok(videoMetrics.includes("post_video_avg_time_watched"));

  const imageMetrics = imagePlan.insightsMetrics.map((m) => m.providerMetric);
  assert.ok(!imageMetrics.includes("post_video_views"));
  assert.ok(!imageMetrics.includes("post_video_avg_time_watched"));
});

test("reel gets the same video candidate set as feedVideo (no reliable way to distinguish them)", () => {
  const reelPlan = planFacebookPostInsightsRequest({ contentType: "reel", grantedPermissions: GRANTED });
  const videoPlan = planFacebookPostInsightsRequest({ contentType: "feedVideo", grantedPermissions: GRANTED });
  const reelMetrics = reelPlan.insightsMetrics.map((m) => m.providerMetric).sort();
  const videoMetrics = videoPlan.insightsMetrics.map((m) => m.providerMetric).sort();
  assert.deepEqual(reelMetrics, videoMetrics);
});

test("missing pages_read_engagement excludes engagement counters with reason permissionRequired", () => {
  const plan = planFacebookPostInsightsRequest({
    contentType: "imagePost",
    grantedPermissions: ["public_profile", "pages_show_list", "read_insights"],
  });
  assert.equal(plan.objectFieldMetrics.length, 0);
  const excludedReasons = plan.excludedMetrics
    .filter((m) => m.providerMetric === "likes.summary(true)")
    .map((m) => m.reason);
  assert.deepEqual(excludedReasons, ["permissionRequired"]);
});

test("missing read_insights excludes every /insights candidate but not the object-field engagement counters", () => {
  const plan = planFacebookPostInsightsRequest({
    contentType: "imagePost",
    grantedPermissions: ["public_profile", "pages_show_list", "pages_read_engagement"],
  });
  assert.ok(plan.objectFieldMetrics.length > 0);
  assert.equal(plan.insightsMetrics.length, 0);
});

test("Page-level plan excludes deprecated page_impressions_unique and requests page_impressions", () => {
  const plan = planFacebookPageInsightsRequest({ grantedPermissions: GRANTED });
  const metricNames = plan.metrics.map((m) => m.providerMetric);
  assert.ok(metricNames.includes("page_impressions"));
  assert.ok(!metricNames.includes("page_impressions_unique"));
  const excludedNames = plan.excludedMetrics.map((m) => m.providerMetric);
  assert.ok(excludedNames.includes("page_impressions_unique"));
});
