import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decryptCredential,
  encryptCredential,
  isEncryptionAvailable,
} from "@/infrastructure/crypto/encryption";

test("encrypts a credential payload without leaking plaintext in the envelope", () => {
  const originalKey = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = "test-encryption-key-value";
  try {
    const envelope = encryptCredential({ accessToken: "super-secret-token-value" });
    assert.equal(envelope.algorithm, "aes-256-gcm");
    assert.ok(envelope.iv.length > 0);
    assert.ok(envelope.authTag.length > 0);
    assert.ok(!envelope.ciphertext.includes("super-secret-token-value"));
    assert.ok(!JSON.stringify(envelope).includes("super-secret-token-value"));
  } finally {
    process.env.APP_ENCRYPTION_KEY = originalKey;
  }
});

test("decrypts a credential payload only with the matching key, server-side", () => {
  const originalKey = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = "test-encryption-key-value";
  try {
    const envelope = encryptCredential({ accessToken: "round-trip-token" });
    const decrypted = decryptCredential(envelope);
    assert.equal(decrypted.accessToken, "round-trip-token");
  } finally {
    process.env.APP_ENCRYPTION_KEY = originalKey;
  }
});

test("decryption fails with the wrong key", () => {
  const originalKey = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = "key-one";
  let envelope: ReturnType<typeof encryptCredential>;
  try {
    envelope = encryptCredential({ accessToken: "token" });
  } finally {
    process.env.APP_ENCRYPTION_KEY = originalKey;
  }

  process.env.APP_ENCRYPTION_KEY = "key-two";
  try {
    assert.throws(() => decryptCredential(envelope));
  } finally {
    process.env.APP_ENCRYPTION_KEY = originalKey;
  }
});

test("encryption is reported unavailable when APP_ENCRYPTION_KEY is missing", () => {
  const originalKey = process.env.APP_ENCRYPTION_KEY;
  delete process.env.APP_ENCRYPTION_KEY;
  try {
    assert.equal(isEncryptionAvailable(), false);
    assert.throws(() => encryptCredential({ accessToken: "x" }));
  } finally {
    process.env.APP_ENCRYPTION_KEY = originalKey;
  }
});
