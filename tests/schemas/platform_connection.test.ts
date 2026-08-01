import { test } from "node:test";
import assert from "node:assert/strict";

import { validatePlatformConnection, ValidationError } from "@/application/validation/validators";

const validBase = {
  schemaVersion: "1.0.0",
  connectionId: "connection_instagram_primary",
  platform: "instagram",
  connectionTarget: "account",
  status: "connected",
  externalAccountId: "external-id",
  displayName: "account-name",
  accountType: "professional",
  grantedScopes: [] as string[],
  connectedAt: "2026-07-28T18:00:00Z",
  lastVerifiedAt: "2026-07-28T18:00:00Z",
  createdAt: "2026-07-28T18:00:00Z",
  updatedAt: "2026-07-28T18:00:00Z",
};

test("accepts a valid platformConnection record", () => {
  const result = validatePlatformConnection(validBase);
  assert.equal(result.connectionId, "connection_instagram_primary");
});

test("accepts a minimal record with only required fields", () => {
  const minimal = {
    schemaVersion: "1.0.0",
    connectionId: "connection_pinterest_primary",
    platform: "pinterest",
    connectionTarget: "account",
    status: "notConnected",
    createdAt: "2026-07-28T18:00:00Z",
    updatedAt: "2026-07-28T18:00:00Z",
  };
  const result = validatePlatformConnection(minimal);
  assert.equal(result.status, "notConnected");
});

test("rejects an invalid platform value", () => {
  assert.throws(
    () => validatePlatformConnection({ ...validBase, platform: "tiktok" }),
    ValidationError,
  );
});

test("rejects an invalid status value", () => {
  assert.throws(
    () => validatePlatformConnection({ ...validBase, status: "publishing" }),
    ValidationError,
  );
});

test("rejects an invalid connectionTarget value", () => {
  assert.throws(
    () => validatePlatformConnection({ ...validBase, connectionTarget: "profile" }),
    ValidationError,
  );
});

test("rejects a record missing a required field", () => {
  const { createdAt: _createdAt, ...withoutCreatedAt } = validBase;
  assert.throws(() => validatePlatformConnection(withoutCreatedAt), ValidationError);
});

test("rejects credential-shaped fields as additional properties", () => {
  assert.throws(
    () => validatePlatformConnection({ ...validBase, accessToken: "should-not-be-here" }),
    ValidationError,
  );
});

test("accepts connectionAttemptStartedAt on a connecting record", () => {
  const connecting = {
    ...validBase,
    status: "connecting",
    connectionAttemptStartedAt: "2026-07-29T18:00:00Z",
  };
  const result = validatePlatformConnection(connecting);
  assert.equal(result.connectionAttemptStartedAt, "2026-07-29T18:00:00Z");
});

test("accepts parentConnectionId for a Facebook Page record", () => {
  const page = {
    ...validBase,
    connectionId: "connection_facebook_page_primary",
    platform: "facebook",
    connectionTarget: "page",
    parentConnectionId: "connection_facebook_account_primary",
  };
  const result = validatePlatformConnection(page);
  assert.equal(result.parentConnectionId, "connection_facebook_account_primary");
});
