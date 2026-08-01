import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveDisplayedErrorMessage } from "@/app/connectionMessages";

// Regression test: after any action, actionErrors[connectionId] is reset
// to "" (a defined empty string), not undefined. A naive `??` combine
// treats "" as a real value and renders a blank message even though a
// real, non-empty persisted safeErrorMessage exists — this is exactly
// what made a working button look "dead" right after clicking, without
// a full page reload.
test("an empty-string action error still falls through to the persisted safeErrorMessage", () => {
  const displayed = resolveDisplayedErrorMessage("", "Instagram is not configured. Missing environment variable(s): INSTAGRAM_APP_ID.");
  assert.equal(
    displayed,
    "Instagram is not configured. Missing environment variable(s): INSTAGRAM_APP_ID.",
  );
});

test("a real action error takes priority over the persisted message", () => {
  const displayed = resolveDisplayedErrorMessage("The request failed.", "Some persisted message.");
  assert.equal(displayed, "The request failed.");
});

test("no error at all when both are absent", () => {
  assert.equal(resolveDisplayedErrorMessage(undefined, undefined), undefined);
  assert.equal(resolveDisplayedErrorMessage("", undefined), undefined);
});
