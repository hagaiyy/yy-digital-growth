import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contentTypeLabel,
  humanizeInternalMetricName,
  tabLabel,
  tabSortKey,
} from "@/application/performance/labels";

test("tabLabel matches the task's worked examples", () => {
  assert.equal(tabLabel("instagram", "reel"), "Instagram — Reels");
  assert.equal(tabLabel("instagram", "carousel"), "Instagram — Carousels");
  assert.equal(tabLabel("instagram", "imagePost"), "Instagram — Images");
  assert.equal(tabLabel("instagram", "story"), "Instagram — Stories");
  assert.equal(tabLabel("facebook", "imagePost"), "Facebook — Image Posts");
  assert.equal(tabLabel("facebook", "linkPost"), "Facebook — Link Posts");
});

test("Facebook and Instagram imagePost get different labels", () => {
  assert.equal(contentTypeLabel("facebook", "imagePost"), "Image Posts");
  assert.equal(contentTypeLabel("instagram", "imagePost"), "Images");
});

test("tabSortKey groups Instagram before Facebook before Pinterest", () => {
  const ig = tabSortKey("instagram", "reel");
  const fb = tabSortKey("facebook", "imagePost");
  const pin = tabSortKey("pinterest", "pin");
  assert.ok(ig[0] < fb[0]);
  assert.ok(fb[0] < pin[0]);
});

test("humanizeInternalMetricName splits camelCase into title case", () => {
  assert.equal(humanizeInternalMetricName("likes"), "Likes");
  assert.equal(humanizeInternalMetricName("engagedUsers"), "Engaged Users");
  assert.equal(humanizeInternalMetricName("averageWatchTimeMs"), "Average Watch Time Ms");
});
