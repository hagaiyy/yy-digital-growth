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

test("maps a plain Instagram feed VIDEO to feedVideo, not reel", () => {
  assert.equal(mapInstagramContentType("VIDEO", "FEED"), "feedVideo");
});

test("does not guess an unrecognized Instagram media type", () => {
  assert.equal(mapInstagramContentType("AUDIO", undefined), "unknown");
  assert.equal(mapInstagramContentType(undefined, undefined), "unknown");
});

test("maps a Facebook video attachment to feedVideo, never guessing reel", () => {
  assert.equal(mapFacebookContentType("video_inline", "video", undefined, undefined), "feedVideo");
  assert.equal(mapFacebookContentType("video_autoplay", undefined, undefined, undefined), "feedVideo");
});

test("maps a Facebook photo attachment to imagePost", () => {
  assert.equal(mapFacebookContentType("photo", "photo", undefined, undefined), "imagePost");
});

test("maps a Facebook album attachment to album", () => {
  assert.equal(mapFacebookContentType("album", undefined, undefined, undefined), "album");
});

test("maps a Facebook link/share attachment to linkPost", () => {
  assert.equal(mapFacebookContentType("share", "link", undefined, undefined), "linkPost");
  assert.equal(mapFacebookContentType("native_templates", "link", undefined, undefined), "linkPost");
});

test("maps a Facebook status update with no attachment to textPost", () => {
  assert.equal(mapFacebookContentType(undefined, undefined, "status", undefined), "textPost");
  assert.equal(mapFacebookContentType(undefined, undefined, undefined, "mobile_status_update"), "textPost");
});

test("does not guess an unrecognized Facebook attachment or object type", () => {
  assert.equal(mapFacebookContentType("event", undefined, undefined, undefined), "unknown");
  assert.equal(mapFacebookContentType(undefined, undefined, undefined, undefined), "unknown");
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
