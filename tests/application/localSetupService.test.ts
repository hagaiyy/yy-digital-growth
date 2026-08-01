import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { LocalSetupService } from "@/application/services/LocalSetupService";
import { SafeServiceError } from "@/application/services/ConnectionService";

function makeService(overrides?: { liveReloadTimeoutMs?: number }): { service: LocalSetupService; dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "local-setup-service-test-"));
  const file = path.join(dir, ".env.local");
  const service = new LocalSetupService({ envFilePath: file, liveReloadTimeoutMs: overrides?.liveReloadTimeoutMs ?? 50 });
  return { service, dir, file };
}

// Scenario 3: secret values are never present in the status response —
// only the boolean "configured" flag, never the actual value.
test("getEnvironmentStatus never includes variable values, only configured booleans", () => {
  const previous = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = "super-secret-value";
  try {
    const { service } = makeService();
    const status = service.getEnvironmentStatus();
    const serialized = JSON.stringify(status);
    assert.ok(!serialized.includes("super-secret-value"));
    const metaSecret = status.find((v) => v.name === "META_APP_SECRET");
    assert.ok(metaSecret);
    assert.equal(metaSecret!.configured, true);
    assert.equal(metaSecret!.secret, true);
    assert.equal(Object.keys(metaSecret!).sort().join(","), "configured,name,platform,secret");
  } finally {
    if (previous === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previous;
  }
});

// A placeholder value already sitting in .env.local (e.g. left over from
// an earlier test run) must be reported as NOT configured, or the
// dashboard would skip the setup modal and drive the user straight into
// a live OAuth redirect that is guaranteed to fail.
test("getEnvironmentStatus reports a placeholder value as configured: false", () => {
  const previous = process.env.META_APP_ID;
  process.env.META_APP_ID = "test-meta-app-id-123";
  try {
    const { service } = makeService();
    const status = service.getEnvironmentStatus();
    assert.equal(status.find((v) => v.name === "META_APP_ID")?.configured, false);
  } finally {
    if (previous === undefined) delete process.env.META_APP_ID;
    else process.env.META_APP_ID = previous;
  }
});

test("getEnvironmentStatus reports unconfigured variables as configured: false", () => {
  const previous = process.env.PINTEREST_APP_ID;
  delete process.env.PINTEREST_APP_ID;
  try {
    const { service } = makeService();
    const status = service.getEnvironmentStatus();
    const pinterestAppId = status.find((v) => v.name === "PINTEREST_APP_ID");
    assert.equal(pinterestAppId?.configured, false);
  } finally {
    if (previous !== undefined) process.env.PINTEREST_APP_ID = previous;
  }
});

// Scenario 6: allowed variables save successfully and are written to disk.
test("saveEnvironmentValues writes allowed variables to the env file", async () => {
  const { service, dir, file } = makeService();
  try {
    const result = await service.saveEnvironmentValues({ META_APP_ID: "valid-app-id-123" });
    assert.deepEqual(result.savedVariableNames, ["META_APP_ID"]);
    const content = readFileSync(file, "utf8");
    assert.match(content, /META_APP_ID="valid-app-id-123"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Scenario 7: an unknown variable name is rejected outright.
test("saveEnvironmentValues rejects an unknown variable name", async () => {
  const { service, dir } = makeService();
  try {
    await assert.rejects(
      () => service.saveEnvironmentValues({ SOME_RANDOM_VAR: "value" }),
      (err: unknown) => err instanceof SafeServiceError && err.code === "unknownVariable",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Scenario 8: an empty value is rejected.
test("saveEnvironmentValues rejects an empty value", async () => {
  const { service, dir } = makeService();
  try {
    await assert.rejects(
      () => service.saveEnvironmentValues({ META_APP_ID: "" }),
      (err: unknown) => err instanceof SafeServiceError && err.code === "emptyValue",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveEnvironmentValues rejects an empty submission", async () => {
  const { service, dir } = makeService();
  try {
    await assert.rejects(
      () => service.saveEnvironmentValues({}),
      (err: unknown) => err instanceof SafeServiceError && err.code === "emptyRequest",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Scenario 9: a newline embedded in a value is rejected.
test("saveEnvironmentValues rejects a value containing a newline", async () => {
  const { service, dir } = makeService();
  try {
    await assert.rejects(
      () => service.saveEnvironmentValues({ META_APP_SECRET: "line1\nline2" }),
      (err: unknown) => err instanceof SafeServiceError && err.code === "invalidValue",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Placeholder values are not accepted as valid app configuration, even
// through the setup modal's own save path — this is the second line of
// defense alongside the connectors treating an already-saved placeholder
// as unconfigured.
test("saveEnvironmentValues rejects an obvious placeholder value", async () => {
  const { service, dir } = makeService();
  try {
    await assert.rejects(
      () => service.saveEnvironmentValues({ META_APP_ID: "test-meta-app-id-123" }),
      (err: unknown) => err instanceof SafeServiceError && err.code === "placeholderValue",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveEnvironmentValues rejects a redirect URI that is not localhost", async () => {
  const { service, dir } = makeService();
  try {
    await assert.rejects(
      () => service.saveEnvironmentValues({ META_REDIRECT_URI: "https://example.com/callback" }),
      (err: unknown) => err instanceof SafeServiceError && err.code === "invalidValue",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveEnvironmentValues accepts a localhost redirect URI", async () => {
  const { service, dir, file } = makeService();
  try {
    const uri = "http://localhost:3000/api/connections/facebook/callback";
    const result = await service.saveEnvironmentValues({ META_REDIRECT_URI: uri });
    assert.deepEqual(result.savedVariableNames, ["META_REDIRECT_URI"]);
    assert.match(readFileSync(file, "utf8"), /META_REDIRECT_URI="http:\/\/localhost:3000/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveEnvironmentValues reports restartRequired true when the live process does not yet see the new value", async () => {
  const { service, dir } = makeService({ liveReloadTimeoutMs: 50 });
  const previous = process.env.PINTEREST_APP_ID;
  delete process.env.PINTEREST_APP_ID;
  try {
    const result = await service.saveEnvironmentValues({ PINTEREST_APP_ID: "some-app-id" });
    assert.equal(result.restartRequired, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (previous !== undefined) process.env.PINTEREST_APP_ID = previous;
  }
});

test("saveEnvironmentValues reports restartRequired false once the live process already sees the value", async () => {
  const { service, dir } = makeService({ liveReloadTimeoutMs: 1000 });
  const previous = process.env.PINTEREST_APP_ID;
  try {
    // Simulate the dev server's file watcher having already reloaded the
    // value into process.env by the time the poll checks it.
    setTimeout(() => {
      process.env.PINTEREST_APP_ID = "some-app-id";
    }, 10);
    const result = await service.saveEnvironmentValues({ PINTEREST_APP_ID: "some-app-id" });
    assert.equal(result.restartRequired, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.PINTEREST_APP_ID;
    else process.env.PINTEREST_APP_ID = previous;
  }
});

// Scenario 17: the generated encryption key has sufficient entropy/length
// and two successive calls produce different values.
test("generateEncryptionKey produces a high-entropy value and differs across calls", async () => {
  const { service: serviceA, dir: dirA, file: fileA } = makeService();
  const { service: serviceB, dir: dirB, file: fileB } = makeService();
  try {
    await serviceA.generateEncryptionKey();
    await serviceB.generateEncryptionKey();
    const contentA = readFileSync(fileA, "utf8");
    const contentB = readFileSync(fileB, "utf8");
    const keyA = contentA.match(/APP_ENCRYPTION_KEY="([^"]+)"/)?.[1];
    const keyB = contentB.match(/APP_ENCRYPTION_KEY="([^"]+)"/)?.[1];
    assert.ok(keyA && keyA.length >= 32, "expected a reasonably long generated key");
    assert.ok(keyB && keyB.length >= 32);
    assert.notEqual(keyA, keyB, "two generated keys must not collide");
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

// Scenario 18: the generated key is never returned to the caller and
// never logged — verified structurally via the return type shape plus a
// console spy to catch any accidental logging.
test("generateEncryptionKey never returns or logs the generated key value", async () => {
  const { service, dir, file } = makeService();
  const originalLog = console.log;
  const originalError = console.error;
  const loggedMessages: string[] = [];
  console.log = (...args: unknown[]) => {
    loggedMessages.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    loggedMessages.push(args.map(String).join(" "));
  };
  try {
    const result = await service.generateEncryptionKey();
    assert.deepEqual(Object.keys(result).sort(), ["restartRequired", "savedVariableNames"]);
    assert.deepEqual(result.savedVariableNames, ["APP_ENCRYPTION_KEY"]);
    const generatedKey = readFileSync(file, "utf8").match(/APP_ENCRYPTION_KEY="([^"]+)"/)?.[1];
    assert.ok(generatedKey);
    for (const message of loggedMessages) {
      assert.ok(!message.includes(generatedKey!), "the generated key must never be logged");
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
    rmSync(dir, { recursive: true, force: true });
  }
});
