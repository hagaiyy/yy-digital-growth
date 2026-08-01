import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mapFacebookContentType,
  mapInstagramContentType,
  mapPinterestContentType,
} from "@/application/mapping/contentTypeMapping";

test("maps Instagram Reel to reel", () => {
  assert.equal(mapInstagramContentType("VIDEO", "REELS"), "reel");
});

test("maps Instagram story product type to story", () => {
  assert.equal(mapInstagramContentType("VIDEO", "STORY"), "story");
});

test("maps Instagram carousel album to carousel", () => {
  assert.equal(mapInstagramContentType("CAROUSEL_ALBUM", "FEED"), "carousel");
});

test("maps Instagram image to imagePost", () => {
  assert.equal(mapInstagramContentType("IMAGE", "FEED"), "imagePost");
});

test("does not guess an unrecognized Instagram media type", () => {
  assert.equal(mapInstagramContentType("AUDIO", undefined), "unknown");
  assert.equal(mapInstagramContentType(undefined, undefined), "unknown");
});

test("maps Facebook Reel to reel", () => {
  assert.equal(mapFacebookContentType(true, "video_inline"), "reel");
});

test("maps Facebook video attachment to video", () => {
  assert.equal(mapFacebookContentType(false, "video_inline"), "video");
});

test("maps Facebook photo attachment to imagePost", () => {
  assert.equal(mapFacebookContentType(false, "photo"), "imagePost");
});

test("does not guess an unrecognized Facebook attachment type", () => {
  assert.equal(mapFacebookContentType(false, "event"), "unknown");
  assert.equal(mapFacebookContentType(false, undefined), "unknown");
});

test("maps Pinterest image Pin to pin", () => {
  assert.equal(mapPinterestContentType("image"), "pin");
});

test("maps Pinterest video Pin to videoPin", () => {
  assert.equal(mapPinterestContentType("video"), "videoPin");
});

test("does not guess an unrecognized Pinterest media type", () => {
  assert.equal(mapPinterestContentType("carousel"), "unknown");
  assert.equal(mapPinterestContentType(undefined), "unknown");
});
