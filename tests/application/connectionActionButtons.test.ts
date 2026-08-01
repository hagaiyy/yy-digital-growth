import { test } from "node:test";
import assert from "node:assert/strict";

import { getConnectionActionButtons } from "@/app/connectionActionButtons";

function labelsOf(buttons: ReturnType<typeof getConnectionActionButtons>) {
  return buttons.map((b) => b.label);
}

const fullHandlers = { hasOnConnect: true, hasOnVerify: true, hasOnDisconnect: true };

// Scenario 1: setupRequired renders a Connect button.
test("setupRequired renders a visible, enabled Connect button", () => {
  const buttons = getConnectionActionButtons({ status: "setupRequired", ...fullHandlers, busy: false });
  assert.ok(buttons.some((b) => b.kind === "connect" && b.label === "Connect" && !b.disabled));
});

// Scenario 2: notConnected renders a Connect button.
test("notConnected renders a visible, enabled Connect button", () => {
  const buttons = getConnectionActionButtons({ status: "notConnected", ...fullHandlers, busy: false });
  assert.ok(buttons.some((b) => b.kind === "connect" && b.label === "Connect" && !b.disabled));
});

// Scenario 3: connected renders Verify and Disconnect.
test("connected renders both Verify and Disconnect", () => {
  const buttons = getConnectionActionButtons({ status: "connected", ...fullHandlers, busy: false });
  assert.equal(labelsOf(buttons).includes("Verify"), true);
  assert.equal(labelsOf(buttons).includes("Disconnect"), true);
  assert.equal(buttons.some((b) => b.kind === "connect"), false, "connected must not also show Connect");
});

// Scenario 4: expired renders Reconnect.
test("expired renders a Reconnect button", () => {
  const buttons = getConnectionActionButtons({ status: "expired", ...fullHandlers, busy: false });
  assert.ok(buttons.some((b) => b.kind === "reconnect" && b.label === "Reconnect" && !b.disabled));
});

// Scenario 5: failed renders Reconnect.
test("failed renders a Reconnect button", () => {
  const buttons = getConnectionActionButtons({ status: "failed", ...fullHandlers, busy: false });
  assert.ok(buttons.some((b) => b.kind === "reconnect" && b.label === "Reconnect" && !b.disabled));
});

// Scenario 6: connecting disables the action.
test("connecting renders a disabled button, not passive text", () => {
  const buttons = getConnectionActionButtons({ status: "connecting", ...fullHandlers, busy: false });
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0]!.disabled, true);
  assert.equal(buttons[0]!.label, "Connecting...");
});

// A card must never be stuck with only a disabled "Connecting..."
// indicator — an enabled way out is always available too.
test("connecting with hasOnReset also renders an enabled Reset Connection Attempt button", () => {
  const buttons = getConnectionActionButtons({
    status: "connecting",
    ...fullHandlers,
    hasOnReset: true,
    busy: false,
  });
  assert.equal(buttons.length, 2);
  assert.ok(buttons.some((b) => b.kind === "connecting" && b.disabled === true));
  assert.ok(
    buttons.some((b) => b.kind === "reset" && b.label === "Reset Connection Attempt" && b.disabled === false),
  );
});

test("connecting without hasOnReset still renders only the disabled indicator", () => {
  const buttons = getConnectionActionButtons({ status: "connecting", ...fullHandlers, busy: false });
  assert.equal(buttons.length, 1);
});

test("failed and expired also offer Reset Connection Attempt alongside Reconnect", () => {
  for (const status of ["failed", "expired"] as const) {
    const buttons = getConnectionActionButtons({ status, ...fullHandlers, hasOnReset: true, busy: false });
    assert.ok(buttons.some((b) => b.kind === "reconnect" && !b.disabled), `${status} must offer Reconnect`);
    assert.ok(
      buttons.some((b) => b.kind === "reset" && b.label === "Reset Connection Attempt"),
      `${status} must offer Reset Connection Attempt`,
    );
  }
});

test("no card is left with zero action buttons across the whole status matrix", () => {
  const statuses = ["notConnected", "setupRequired", "connecting", "connected", "expired", "failed"] as const;
  for (const status of statuses) {
    const buttons = getConnectionActionButtons({ status, ...fullHandlers, busy: false });
    assert.ok(buttons.length > 0, `status "${status}" must render at least one actionable/disabled button`);
  }
});

test("a gated Connect (no onConnect) shows the disabled reason instead of nothing", () => {
  const buttons = getConnectionActionButtons({
    status: "notConnected",
    hasOnConnect: false,
    hasOnVerify: false,
    hasOnDisconnect: false,
    connectDisabledReason: "Connect Facebook Account First",
    busy: false,
  });
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0]!.label, "Connect Facebook Account First");
  assert.equal(buttons[0]!.disabled, true);
});

test("a custom connectLabel is used only while not connected, not for Reconnect", () => {
  const notConnected = getConnectionActionButtons({
    status: "notConnected",
    ...fullHandlers,
    connectLabel: "Select Facebook Page",
    busy: false,
  });
  assert.equal(notConnected.find((b) => b.kind === "connect")?.label, "Select Facebook Page");

  const expired = getConnectionActionButtons({
    status: "expired",
    ...fullHandlers,
    connectLabel: "Select Facebook Page",
    busy: false,
  });
  assert.equal(expired.find((b) => b.kind === "reconnect")?.label, "Reconnect");
});

test("busy disables the Connect/Reconnect action and relabels it", () => {
  const buttons = getConnectionActionButtons({ status: "notConnected", ...fullHandlers, busy: true });
  const connect = buttons.find((b) => b.kind === "connect")!;
  assert.equal(connect.disabled, true);
  assert.equal(connect.label, "Connecting...");
});
