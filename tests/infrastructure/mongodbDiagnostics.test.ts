import { test } from "node:test";
import assert from "node:assert/strict";

import { tagDiagnosticStage, getDiagnosticStage } from "@/infrastructure/mongodb/diagnostics";

test("tagDiagnosticStage attaches a stage retrievable via getDiagnosticStage", () => {
  const error = new Error("something failed");
  const tagged = tagDiagnosticStage(error, "connection");
  assert.equal(getDiagnosticStage(tagged), "connection");
});

test("tagDiagnosticStage never changes the error's identity, message, or instanceof", () => {
  class CustomError extends Error {}
  const original = new CustomError("original message");
  const tagged = tagDiagnosticStage(original, "collection");
  assert.equal(tagged, original, "must return the same object, not a wrapper");
  assert.equal(tagged.message, "original message");
  assert.ok(tagged instanceof CustomError);
  assert.ok(tagged instanceof Error);
});

test("the stage tag is non-enumerable, so it never appears in JSON.stringify or Object.keys", () => {
  const error = tagDiagnosticStage(new Error("boom"), "query");
  assert.deepEqual(Object.keys(error), []);
  assert.equal(JSON.stringify({ error: error.message }).includes("query"), false);
});

test("getDiagnosticStage returns undefined for an untagged error", () => {
  assert.equal(getDiagnosticStage(new Error("untagged")), undefined);
});

test("getDiagnosticStage returns undefined for non-object/non-error values without throwing", () => {
  assert.equal(getDiagnosticStage(null), undefined);
  assert.equal(getDiagnosticStage(undefined), undefined);
  assert.equal(getDiagnosticStage("a string throw"), undefined);
  assert.equal(getDiagnosticStage(42), undefined);
});

test("tagDiagnosticStage leaves a non-Error thrown value untouched", () => {
  const value = "a string throw";
  assert.equal(tagDiagnosticStage(value, "unknown"), value);
});

test("re-tagging with a different stage overwrites the previous tag", () => {
  const error = new Error("boom");
  tagDiagnosticStage(error, "connection");
  tagDiagnosticStage(error, "collection");
  assert.equal(getDiagnosticStage(error), "collection");
});
