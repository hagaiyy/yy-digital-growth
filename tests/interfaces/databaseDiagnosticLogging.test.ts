import { test } from "node:test";
import assert from "node:assert/strict";
import type { ErrorObject } from "ajv/dist/2020";

import { logSafeDatabaseError } from "@/interfaces/http/databaseDiagnosticLogging";
import { tagDiagnosticStage } from "@/infrastructure/mongodb/diagnostics";
import { ConnectorError } from "@/application/connectors/types";
import { SafeServiceError } from "@/application/services/ConnectionService";
import { ValidationError } from "@/application/validation/validators";

function captureConsoleError(run: () => void): string[] {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    run();
  } finally {
    console.error = original;
  }
  return lines;
}

// The core safety guarantee: even when the underlying error's own
// message contains what looks like a real MongoDB URI with embedded
// credentials (exactly what a real driver connection error can include),
// the logged output must never contain that message at all.
test("logSafeDatabaseError never includes the original error message, even when it contains a connection string", () => {
  const sensitiveUri = "mongodb+srv://realuser:realpassword123@cluster0.abcde.mongodb.net/prod";
  const error = tagDiagnosticStage(
    new Error(`connection to ${sensitiveUri} failed: authentication error`),
    "connection",
  );
  const lines = captureConsoleError(() => logSafeDatabaseError("api/connections", error, "unknown"));
  assert.equal(lines.length, 1);
  assert.ok(!lines[0]!.includes("realuser"));
  assert.ok(!lines[0]!.includes("realpassword123"));
  assert.ok(!lines[0]!.includes(sensitiveUri));
  assert.ok(!lines[0]!.includes("mongodb+srv://"));
});

test("logSafeDatabaseError never includes a message mentioning APP_ENCRYPTION_KEY, tokens, or credential values", () => {
  const error = tagDiagnosticStage(
    new Error("failed while APP_ENCRYPTION_KEY=abc123def456 accessToken=super-secret-token-value"),
    "decryption",
  );
  const lines = captureConsoleError(() => logSafeDatabaseError("api/connections", error, "unknown"));
  const logged = lines[0]!;
  assert.ok(!logged.includes("abc123def456"));
  assert.ok(!logged.includes("super-secret-token-value"));
  assert.ok(!logged.includes("failed while"));
});

test("logSafeDatabaseError output only ever contains the approved field set", () => {
  const error = tagDiagnosticStage(new Error("some internal detail"), "collection");
  const lines = captureConsoleError(() => logSafeDatabaseError("api/connections", error, "unknown"));
  const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
  const approvedKeys = [
    "route",
    "errorName",
    "stage",
    "safeErrorCode",
    "mongoErrorCodeName",
    "mongoErrorCode",
    "validationPath",
  ];
  for (const key of Object.keys(parsed)) {
    assert.ok(approvedKeys.includes(key), `unexpected field "${key}" in diagnostic log output`);
  }
  assert.equal(parsed.route, "api/connections");
  assert.equal(parsed.stage, "collection");
  assert.equal(parsed.errorName, "Error");
  assert.ok(!("message" in parsed), "the raw error message must never be logged");
});

test("a MongoDB driver-style error logs only codeName/code, never its message", () => {
  const mongoLikeError = new Error(
    "connect ECONNREFUSED to mongodb+srv://user:pass@cluster.mongodb.net, server selection timed out",
  ) as Error & { codeName?: string; code?: number };
  mongoLikeError.name = "MongoServerSelectionError";
  mongoLikeError.codeName = "HostUnreachable";
  mongoLikeError.code = 6;
  tagDiagnosticStage(mongoLikeError, "connection");

  const lines = captureConsoleError(() => logSafeDatabaseError("api/health/database", mongoLikeError, "unknown"));
  const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(parsed.errorName, "MongoServerSelectionError");
  assert.equal(parsed.mongoErrorCodeName, "HostUnreachable");
  assert.equal(parsed.mongoErrorCode, 6);
  assert.equal(parsed.stage, "connection");
  assert.ok(!lines[0]!.includes("mongodb+srv://"));
  assert.ok(!lines[0]!.includes("user:pass"));
});

test("a ValidationError logs only the schema field path, never the invalid value", () => {
  const error = new ValidationError("platformConnection failed schema validation", [
    {
      instancePath: "/status",
      schemaPath: "#/properties/status/enum",
      keyword: "enum",
      params: { allowedValues: ["notConnected"] },
      message: "must be equal to one of the allowed values",
    },
  ] as ErrorObject[]);
  const lines = captureConsoleError(() => logSafeDatabaseError("api/connections", error, "unknown"));
  const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(parsed.stage, "validation");
  assert.equal(parsed.validationPath, "/status");
  assert.ok(!lines[0]!.includes("failed schema validation"));
});

test("our own SafeServiceError/ConnectorError log their existing safe code, unchanged", () => {
  const safeServiceLines = captureConsoleError(() =>
    logSafeDatabaseError("api/connections", new SafeServiceError("notConnected", "irrelevant message"), "query"),
  );
  const safeServiceParsed = JSON.parse(safeServiceLines[0]!) as Record<string, unknown>;
  assert.equal(safeServiceParsed.safeErrorCode, "notConnected");
  assert.ok(!safeServiceLines[0]!.includes("irrelevant message"));

  const connectorLines = captureConsoleError(() =>
    logSafeDatabaseError("api/connections", new ConnectorError("failed", "irrelevant safe message"), "query"),
  );
  const connectorParsed = JSON.parse(connectorLines[0]!) as Record<string, unknown>;
  assert.equal(connectorParsed.safeErrorCode, "failed");
});

test("an untagged error falls back to the caller-provided stage", () => {
  const lines = captureConsoleError(() =>
    logSafeDatabaseError("api/connections", new Error("no stage was tagged"), "query"),
  );
  const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(parsed.stage, "query");
});

test("a non-Error thrown value logs a safe unknown-error placeholder without throwing", () => {
  const lines = captureConsoleError(() => logSafeDatabaseError("api/connections", "a string throw", "unknown"));
  const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(parsed.errorName, "UnknownError");
  assert.equal(parsed.stage, "unknown");
});
