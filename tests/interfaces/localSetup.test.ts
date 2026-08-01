import { test } from "node:test";
import assert from "node:assert/strict";

import { isLocalDevelopmentAllowed, waitForLiveEnvReload, PRODUCTION_BLOCKED_MESSAGE } from "@/interfaces/http/localSetup";

const mutableEnv = process.env as Record<string, string | undefined>;

// Scenario 10: the local setup feature is disabled in production.
test("isLocalDevelopmentAllowed is false when NODE_ENV is production", () => {
  const previous = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  try {
    assert.equal(isLocalDevelopmentAllowed(), false);
  } finally {
    mutableEnv.NODE_ENV = previous;
  }
});

test("isLocalDevelopmentAllowed is true outside production", () => {
  const previous = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "development";
  try {
    assert.equal(isLocalDevelopmentAllowed(), true);
  } finally {
    mutableEnv.NODE_ENV = previous;
  }
});

test("PRODUCTION_BLOCKED_MESSAGE gives a safe, non-technical explanation", () => {
  assert.match(PRODUCTION_BLOCKED_MESSAGE, /development/i);
  assert.ok(!PRODUCTION_BLOCKED_MESSAGE.includes(".env"));
});

test("waitForLiveEnvReload resolves true immediately once every named var is already set", async () => {
  const previous = process.env.TEST_LOCAL_SETUP_VAR_A;
  process.env.TEST_LOCAL_SETUP_VAR_A = "already-set";
  try {
    const started = Date.now();
    const result = await waitForLiveEnvReload(["TEST_LOCAL_SETUP_VAR_A"], 5000, 250);
    assert.equal(result, true);
    assert.ok(Date.now() - started < 250, "should not need to poll when the value is already present");
  } finally {
    if (previous === undefined) delete process.env.TEST_LOCAL_SETUP_VAR_A;
    else process.env.TEST_LOCAL_SETUP_VAR_A = previous;
  }
});

test("waitForLiveEnvReload resolves true once a value appears mid-poll", async () => {
  const previous = process.env.TEST_LOCAL_SETUP_VAR_B;
  delete process.env.TEST_LOCAL_SETUP_VAR_B;
  try {
    setTimeout(() => {
      process.env.TEST_LOCAL_SETUP_VAR_B = "appeared-later";
    }, 60);
    const result = await waitForLiveEnvReload(["TEST_LOCAL_SETUP_VAR_B"], 2000, 20);
    assert.equal(result, true);
  } finally {
    if (previous === undefined) delete process.env.TEST_LOCAL_SETUP_VAR_B;
    else process.env.TEST_LOCAL_SETUP_VAR_B = previous;
  }
});

test("waitForLiveEnvReload resolves false after the timeout when the value never appears", async () => {
  const previous = process.env.TEST_LOCAL_SETUP_VAR_C;
  delete process.env.TEST_LOCAL_SETUP_VAR_C;
  try {
    const started = Date.now();
    const result = await waitForLiveEnvReload(["TEST_LOCAL_SETUP_VAR_C"], 100, 20);
    assert.equal(result, false);
    assert.ok(Date.now() - started >= 100);
  } finally {
    if (previous === undefined) delete process.env.TEST_LOCAL_SETUP_VAR_C;
    else process.env.TEST_LOCAL_SETUP_VAR_C = previous;
  }
});

test("waitForLiveEnvReload requires every named variable to be set, not just one of several", async () => {
  const previousA = process.env.TEST_LOCAL_SETUP_VAR_D;
  const previousB = process.env.TEST_LOCAL_SETUP_VAR_E;
  process.env.TEST_LOCAL_SETUP_VAR_D = "set";
  delete process.env.TEST_LOCAL_SETUP_VAR_E;
  try {
    const result = await waitForLiveEnvReload(["TEST_LOCAL_SETUP_VAR_D", "TEST_LOCAL_SETUP_VAR_E"], 80, 20);
    assert.equal(result, false);
  } finally {
    if (previousA === undefined) delete process.env.TEST_LOCAL_SETUP_VAR_D;
    else process.env.TEST_LOCAL_SETUP_VAR_D = previousA;
    if (previousB === undefined) delete process.env.TEST_LOCAL_SETUP_VAR_E;
    else process.env.TEST_LOCAL_SETUP_VAR_E = previousB;
  }
});
