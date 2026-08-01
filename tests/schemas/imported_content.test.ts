import { test } from "node:test";
import assert from "node:assert/strict";

import { validateImportedContent, ValidationError } from "@/application/validation/validators";

const valid = {
  schemaVersion: "1.0.0",
  importedContentId: "imported_content_internal_id",
  connectionId: "connection_instagram_primary",
  platform: "instagram",
  externalContentId: "17897479950464953",
  contentType: "reel",
  status: "active",
  title: null,
  caption: "Published caption",
  hashtags: ["metalart", "reclaimedart"],
  permalink: "https://instagram.com/p/example",
  thumbnailUrl: "https://instagram.com/thumb.jpg",
  publishedAt: "2026-07-28T18:00:00Z",
  platformData: { media_type: "VIDEO" },
  firstImportedAt: "2026-07-29T06:00:00Z",
  lastImportedAt: "2026-07-29T06:00:00Z",
  createdAt: "2026-07-29T06:00:00Z",
  updatedAt: "2026-07-29T06:00:00Z",
};

test("accepts a valid importedContent record", () => {
  const result = validateImportedContent(valid);
  assert.equal(result.externalContentId, "17897479950464953");
});

test("accepts a minimal record with only required fields", () => {
  const minimal = {
    schemaVersion: "1.0.0",
    importedContentId: "imported_content_x",
    connectionId: "connection_pinterest_primary",
    platform: "pinterest",
    externalContentId: "pin-1",
    contentType: "pin",
    status: "active",
    firstImportedAt: "2026-07-29T06:00:00Z",
    lastImportedAt: "2026-07-29T06:00:00Z",
    createdAt: "2026-07-29T06:00:00Z",
    updatedAt: "2026-07-29T06:00:00Z",
  };
  const result = validateImportedContent(minimal);
  assert.equal(result.contentType, "pin");
});

test("rejects an invalid platform value", () => {
  assert.throws(() => validateImportedContent({ ...valid, platform: "tiktok" }), ValidationError);
});

test("rejects an invalid contentType value", () => {
  assert.throws(() => validateImportedContent({ ...valid, contentType: "livestream" }), ValidationError);
});

test("rejects an invalid status value", () => {
  assert.throws(() => validateImportedContent({ ...valid, status: "deleted" }), ValidationError);
});

test("rejects a record missing a required field", () => {
  const { externalContentId: _omit, ...withoutExternalId } = valid;
  assert.throws(() => validateImportedContent(withoutExternalId), ValidationError);
});

test("rejects a credential-shaped top-level field", () => {
  assert.throws(
    () => validateImportedContent({ ...valid, accessToken: "should-not-be-here" }),
    ValidationError,
  );
});

test("accepts null for nullable optional fields", () => {
  const result = validateImportedContent({
    ...valid,
    title: null,
    caption: null,
    permalink: null,
    thumbnailUrl: null,
    publishedAt: null,
  });
  assert.equal(result.title, null);
});
