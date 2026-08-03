import { test } from "node:test";
import assert from "node:assert/strict";

import { contentTypesInGroup, tabGroupFor } from "@/application/performance/storyGrouping";

test("imageStory, videoStory, unknownStory, and the legacy story value all collapse to the 'story' tab group", () => {
  assert.equal(tabGroupFor("imageStory"), "story");
  assert.equal(tabGroupFor("videoStory"), "story");
  assert.equal(tabGroupFor("unknownStory"), "story");
  assert.equal(tabGroupFor("story"), "story");
});

test("every other content type is its own tab group, unaffected by the Story split", () => {
  assert.equal(tabGroupFor("reel"), "reel");
  assert.equal(tabGroupFor("imagePost"), "imagePost");
  assert.equal(tabGroupFor("linkPost"), "linkPost");
});

test("the 'story' group expands to every Story sub-type", () => {
  const expanded = contentTypesInGroup("story");
  assert.ok(expanded.includes("imageStory"));
  assert.ok(expanded.includes("videoStory"));
  assert.ok(expanded.includes("unknownStory"));
  assert.ok(expanded.includes("story"));
});

test("a non-Story group expands to only itself", () => {
  assert.deepEqual(contentTypesInGroup("reel"), ["reel"]);
});
