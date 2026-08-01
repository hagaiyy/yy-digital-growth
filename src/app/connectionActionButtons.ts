import type { ConnectionStatus } from "@/domain/models/PlatformConnection";

export interface ConnectionActionButton {
  kind: "connecting" | "connect" | "reconnect" | "verify" | "disconnect" | "reset";
  label: string;
  disabled: boolean;
}

// Pure decision logic for which action button(s) a connection card shows,
// extracted out of the JSX so it can be unit-tested directly against the
// full status matrix without a component-rendering test setup.
export function getConnectionActionButtons(params: {
  status: ConnectionStatus;
  hasOnConnect: boolean;
  hasOnVerify: boolean;
  hasOnDisconnect: boolean;
  hasOnReset?: boolean;
  connectLabel?: string;
  connectDisabledReason?: string;
  busy: boolean;
}): ConnectionActionButton[] {
  const { status, hasOnConnect, hasOnVerify, hasOnDisconnect, hasOnReset, connectLabel, connectDisabledReason, busy } =
    params;
  const buttons: ConnectionActionButton[] = [];

  if (status === "connecting") {
    buttons.push({ kind: "connecting", label: "Connecting...", disabled: true });
    // A card must never be left with only a disabled indicator: even
    // before the automatic stale-connecting recovery kicks in, the user
    // has an immediate, enabled way out if the redirect never returns.
    if (hasOnReset) {
      buttons.push({ kind: "reset", label: "Reset Connection Attempt", disabled: false });
    }
  }

  if (status === "notConnected" || status === "setupRequired") {
    if (hasOnConnect) {
      buttons.push({
        kind: "connect",
        label: busy ? "Connecting..." : (connectLabel ?? "Connect"),
        disabled: busy,
      });
    } else if (connectDisabledReason) {
      buttons.push({ kind: "connect", label: connectDisabledReason, disabled: true });
    }
  }

  if ((status === "failed" || status === "expired") && hasOnConnect) {
    buttons.push({ kind: "reconnect", label: busy ? "Connecting..." : "Reconnect", disabled: busy });
  }

  if ((status === "failed" || status === "expired") && hasOnReset) {
    buttons.push({ kind: "reset", label: "Reset Connection Attempt", disabled: busy });
  }

  if (status === "connected" && hasOnVerify) {
    buttons.push({ kind: "verify", label: "Verify", disabled: busy });
  }

  if ((status === "connected" || status === "expired" || status === "failed") && hasOnDisconnect) {
    buttons.push({ kind: "disconnect", label: "Disconnect", disabled: busy });
  }

  return buttons;
}
