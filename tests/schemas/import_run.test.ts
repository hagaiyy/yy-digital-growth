import { test } from "node:test";
import assert from "node:assert/strict";

import { validateImportRun, ValidationError } from "@/application/validation/validators";

const valid = {
  schemaVersion: "1.0.0",
  importRunId: "import_run_internal_id",
  status: "completedWithErrors",
  startedAt: "2026-07-29T06:00:00Z",
  completedAt: "2026-07-29T06:00:18Z",
  recentContentLimit: 30,
  totals: {
    connections: 3,
    requestedItems: 90,
    createdItems: 12,
    updatedItems: 70,
    failedItems: 3,
    skippedItems: 5,
  },
  connectionResults: [
    {
      connectionId: "connection_instagram_primary",
      platform: "instagram",
      status: "partial",
      requestedCount: 30,
      createdCount: 5,
      updatedCount: 24,
      failedCount: 1,
      skippedCount: 0,
      itemResults: [
        {
          externalContentId: "ig-item-9",
          contentLabel: "Behind the scenes",
          platform: "instagram",
          status: "failed",
          safeReasonCode: "contentSaveFailed",
          safeMessage: "This content item could not be saved.",
        },
      ],
    },
    {
      connectionId: "connection_facebook_account_primary",
      platform: "facebook",
      status: "unsupported",
      safeErrorCode: "unsupported",
      safeErrorMessage: "Facebook does not provide personal-profile content or analytics.",
    },
  ],
  createdAt: "2026-07-29T06:00:00Z",
  updatedAt: "2026-07-29T06:00:18Z",
};

test("accepts a valid importRun record with nested connection and item results", () => {
  const result = validateImportRun(valid);
  assert.equal(result.connectionResults.length, 2);
  assert.equal(result.connectionResults[0]!.itemResults?.[0]!.status, "failed");
});

test("accepts a minimal running importRun with empty connectionResults", () => {
  const minimal = {
    schemaVersion: "1.0.0",
    importRunId: "import_run_running",
    status: "running",
    startedAt: "2026-07-29T06:00:00Z",
    recentContentLimit: 30,
    totals: { connections: 0, requestedItems: 0, createdItems: 0, updatedItems: 0, failedItems: 0, skippedItems: 0 },
    connectionResults: [],
    createdAt: "2026-07-29T06:00:00Z",
    updatedAt: "2026-07-29T06:00:00Z",
  };
  const result = validateImportRun(minimal);
  assert.equal(result.status, "running");
});

test("rejects an invalid top-level status value", () => {
  assert.throws(() => validateImportRun({ ...valid, status: "queued" }), ValidationError);
});

test("rejects an invalid item-level result status", () => {
  const invalid = {
    ...valid,
    connectionResults: [
      { connectionId: "x", platform: "instagram", status: "success", itemResults: [{ platform: "instagram", status: "cancelled" }] },
    ],
  };
  assert.throws(() => validateImportRun(invalid), ValidationError);
});

test("rejects recentContentLimit outside the allowed range", () => {
  assert.throws(() => validateImportRun({ ...valid, recentContentLimit: 0 }), ValidationError);
  assert.throws(() => validateImportRun({ ...valid, recentContentLimit: 101 }), ValidationError);
});

test("rejects a record missing a required field", () => {
  const { totals: _omit, ...withoutTotals } = valid;
  assert.throws(() => validateImportRun(withoutTotals), ValidationError);
});
