import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { removeEnvKeys, updateEnvFile } from "@/infrastructure/localEnv/envFileWriter";

function tempEnvPath(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "env-writer-test-"));
  return { dir, file: path.join(dir, ".env.local") };
}

// Scenario 11: existing unrelated variables are preserved.
test("preserves unrelated existing variables and comments", async () => {
  const { dir, file } = tempEnvPath();
  try {
    writeFileSync(file, "MONGODB_URI=mongodb://example\nMONGODB_DATABASE=testdb\n# a comment\n");
    await updateEnvFile(file, { META_APP_ID: "abc123" });
    const content = readFileSync(file, "utf8");
    assert.match(content, /MONGODB_URI=mongodb:\/\/example/);
    assert.match(content, /MONGODB_DATABASE=testdb/);
    assert.match(content, /# a comment/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Scenario 12: an existing variable is updated in place, not duplicated.
test("updates an existing variable instead of duplicating it", async () => {
  const { dir, file } = tempEnvPath();
  try {
    writeFileSync(file, "EXISTING_VAR=old\nOTHER=1\n");
    await updateEnvFile(file, { EXISTING_VAR: "new" });
    const content = readFileSync(file, "utf8");
    const occurrences = content.split("\n").filter((line) => line.startsWith("EXISTING_VAR=")).length;
    assert.equal(occurrences, 1);
    assert.match(content, /EXISTING_VAR="new"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Scenario 13: a missing variable is added on its own new line.
test("adds a missing variable on a new line", async () => {
  const { dir, file } = tempEnvPath();
  try {
    writeFileSync(file, "MONGODB_URI=mongodb://example\n");
    await updateEnvFile(file, { META_APP_ID: "abc123" });
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    assert.ok(lines.includes("MONGODB_URI=mongodb://example"));
    assert.ok(lines.includes('META_APP_ID="abc123"'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Scenario 14: a file missing its trailing newline must never have a new
// variable merged onto the end of the previous line.
test("never merges a new variable into the previous line when the file lacks a trailing newline", async () => {
  const { dir, file } = tempEnvPath();
  try {
    writeFileSync(file, "MONGODB_URI=mongodb://example\nMONGODB_DATABASE=testdb");
    await updateEnvFile(file, { APP_ENCRYPTION_KEY: "some-key-value" });
    const content = readFileSync(file, "utf8");
    assert.match(content, /^MONGODB_DATABASE=testdb$/m, "the previous last line must remain intact on its own");
    assert.match(content, /^APP_ENCRYPTION_KEY="some-key-value"$/m, "the new variable must be its own line");
    assert.ok(content.endsWith("\n"), "file must end with exactly one trailing newline");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Scenario 16: a backup is created before modifying.
test("creates a .backup file containing the pre-write content", async () => {
  const { dir, file } = tempEnvPath();
  try {
    const original = "MONGODB_URI=mongodb://example\n";
    writeFileSync(file, original);
    await updateEnvFile(file, { META_APP_ID: "abc123" });
    const backupPath = `${file}.backup`;
    assert.ok(existsSync(backupPath));
    assert.equal(readFileSync(backupPath, "utf8"), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Scenario 15: atomic write — no leftover temp file after the rename.
test("writes atomically, leaving no temp file behind", async () => {
  const { dir, file } = tempEnvPath();
  try {
    writeFileSync(file, "MONGODB_URI=mongodb://example\n");
    await updateEnvFile(file, { META_APP_ID: "abc123" });
    const leftoverTempFiles = readdirSync(dir).filter((name) => name.includes(".tmp-"));
    assert.deepEqual(leftoverTempFiles, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Scenario 19: simultaneous writes are prevented from clobbering one another.
test("concurrent writes to the same file are serialized, not lost", async () => {
  const { dir, file } = tempEnvPath();
  try {
    writeFileSync(file, "MONGODB_URI=mongodb://example\n");
    await Promise.all([
      updateEnvFile(file, { META_APP_ID: "first-value" }),
      updateEnvFile(file, { PINTEREST_APP_ID: "second-value" }),
    ]);
    const content = readFileSync(file, "utf8");
    assert.match(content, /META_APP_ID="first-value"/);
    assert.match(content, /PINTEREST_APP_ID="second-value"/);
    assert.match(content, /MONGODB_URI=mongodb:\/\/example/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("handles a file that already ends with a trailing newline without adding a blank line", async () => {
  const { dir, file } = tempEnvPath();
  try {
    writeFileSync(file, "MONGODB_URI=mongodb://example\n\n");
    await updateEnvFile(file, { META_APP_ID: "abc123" });
    const content = readFileSync(file, "utf8");
    assert.ok(!content.includes("\n\n\n"), "must not accumulate extra blank lines");
    assert.match(content, /META_APP_ID="abc123"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("escapes quotes and backslashes so the value round-trips exactly", async () => {
  const { dir, file } = tempEnvPath();
  try {
    writeFileSync(file, "MONGODB_URI=mongodb://example\n");
    const value = 'weird"quote\\backslash value';
    await updateEnvFile(file, { META_APP_SECRET: value });
    const content = readFileSync(file, "utf8");
    const line = content.split("\n").find((l) => l.startsWith("META_APP_SECRET="))!;
    let recovered = line.slice("META_APP_SECRET=".length);
    recovered = recovered.slice(1, -1).replace(/\\\\/g, "\\").replace(/\\"/g, '"');
    assert.equal(recovered, value);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// removeEnvKeys: used to strip placeholder credentials out of
// .env.local without disturbing anything else in the file.
test("removeEnvKeys deletes only the keys the predicate matches, leaving unrelated variables and comments untouched", async () => {
  const { dir, file } = tempEnvPath();
  try {
    writeFileSync(
      file,
      [
        "MONGODB_URI=mongodb://example",
        "MONGODB_DATABASE=testdb",
        "# a comment",
        'META_APP_ID="test-meta-app-id-123"',
        'META_APP_SECRET="test-meta-app-secret-456"',
        'META_REDIRECT_URI="http://localhost:3000/api/connections/facebook/callback"',
        "",
      ].join("\n"),
    );
    const result = await removeEnvKeys(file, (key) => key === "META_APP_ID" || key === "META_APP_SECRET");
    assert.deepEqual(result.removedKeys.sort(), ["META_APP_ID", "META_APP_SECRET"]);
    const content = readFileSync(file, "utf8");
    assert.match(content, /MONGODB_URI=mongodb:\/\/example/);
    assert.match(content, /MONGODB_DATABASE=testdb/);
    assert.match(content, /# a comment/);
    assert.match(content, /META_REDIRECT_URI="http:\/\/localhost:3000/);
    assert.ok(!content.includes("META_APP_ID"));
    assert.ok(!content.includes("META_APP_SECRET"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removeEnvKeys never removes a key the predicate declines, and never touches MongoDB variables", async () => {
  const { dir, file } = tempEnvPath();
  try {
    writeFileSync(
      file,
      'MONGODB_URI=mongodb://example\nMETA_APP_ID="real-app-id-not-a-placeholder"\n',
    );
    const result = await removeEnvKeys(file, (key, value) => key === "META_APP_ID" && value.startsWith("test-"));
    assert.deepEqual(result.removedKeys, []);
    const content = readFileSync(file, "utf8");
    assert.match(content, /MONGODB_URI=mongodb:\/\/example/);
    assert.match(content, /META_APP_ID="real-app-id-not-a-placeholder"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removeEnvKeys creates a backup before modifying, and leaves no temp file behind", async () => {
  const { dir, file } = tempEnvPath();
  try {
    const original = 'MONGODB_URI=mongodb://example\nMETA_APP_ID="test-placeholder"\n';
    writeFileSync(file, original);
    await removeEnvKeys(file, (key) => key === "META_APP_ID");
    assert.equal(readFileSync(`${file}.backup`, "utf8"), original);
    const leftoverTempFiles = readdirSync(dir).filter((name) => name.includes(".tmp-"));
    assert.deepEqual(leftoverTempFiles, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removeEnvKeys does nothing to a file with no trailing newline other than removing the matched key", async () => {
  const { dir, file } = tempEnvPath();
  try {
    writeFileSync(file, 'MONGODB_URI=mongodb://example\nMETA_APP_ID="test-placeholder"');
    const result = await removeEnvKeys(file, (key) => key === "META_APP_ID");
    assert.deepEqual(result.removedKeys, ["META_APP_ID"]);
    const content = readFileSync(file, "utf8");
    assert.equal(content, "MONGODB_URI=mongodb://example\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("creates the file when it does not exist yet, with no backup required", async () => {
  const { dir, file } = tempEnvPath();
  try {
    await updateEnvFile(file, { META_APP_ID: "abc123" });
    assert.ok(existsSync(file));
    assert.ok(!existsSync(`${file}.backup`), "no backup should be made when there was nothing to back up");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
