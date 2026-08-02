"use client";

import { useEffect, useState } from "react";

import { isEligibleDataImportSource, type PlatformConnection } from "@/domain/models/PlatformConnection";
import { CONNECTION_IDS } from "@/domain/connectionIds";
import { DataImportPanel } from "@/components/DataImportPanel";
import { PerformanceView } from "@/components/performance/PerformanceView";
import { getConnectionActionButtons } from "@/app/connectionActionButtons";
import { resolveDisplayedErrorMessage } from "@/app/connectionMessages";
import { LocalSetupModal } from "@/components/LocalSetupModal";
import { PLATFORM_REQUIRED_VARIABLES } from "@/config/localSetupVariables";

type OAuthPlatform = "instagram" | "facebook" | "pinterest";

const OAUTH_PLATFORM_LABELS: Record<OAuthPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook Account",
  pinterest: "Pinterest",
};

const OAUTH_CONNECT_PATHS: Record<OAuthPlatform, string> = {
  instagram: "/api/connections/instagram/connect",
  facebook: "/api/connections/facebook/connect",
  pinterest: "/api/connections/pinterest/connect",
};

interface EnvironmentStatusResponse {
  variables: EnvironmentVariableStatus[];
}

interface EnvironmentVariableStatus {
  name: string;
  configured: boolean;
}

type Tab = "connections" | "import" | "performance";

interface FacebookPageOption {
  id: string;
  name: string;
  category?: string;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: { code: string; message: string } })
    | null;
  if (!response.ok) {
    const message = body?.error?.message ?? "The request failed.";
    throw new Error(message);
  }
  return body as T;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US");
}

function ConnectionCard({
  title,
  subtitle,
  connection,
  busy,
  errorMessage,
  successMessage,
  onConnect,
  connectLabel,
  connectDisabledReason,
  onVerify,
  onDisconnect,
  onReset,
  extra,
}: {
  title: string;
  subtitle?: string;
  connection: PlatformConnection | undefined;
  busy: boolean;
  errorMessage?: string;
  successMessage?: string;
  onConnect?: () => void;
  connectLabel?: string;
  connectDisabledReason?: string;
  onVerify?: () => void;
  onDisconnect?: () => void;
  onReset?: () => void;
  extra?: React.ReactNode;
}) {
  const status = connection?.status ?? "notConnected";
  const actionButtons = getConnectionActionButtons({
    status,
    hasOnConnect: Boolean(onConnect),
    hasOnVerify: Boolean(onVerify),
    hasOnDisconnect: Boolean(onDisconnect),
    hasOnReset: Boolean(onReset),
    connectLabel,
    connectDisabledReason,
    busy,
  });

  return (
    <section
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        padding: "1rem 1.25rem",
        marginBottom: "1rem",
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: subtitle ? "0.15rem" : undefined }}>{title}</h3>
      {subtitle && <p style={{ marginTop: 0, marginBottom: "0.75rem", color: "var(--color-text-muted)" }}>{subtitle}</p>}
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.15rem 0.75rem", margin: 0 }}>
        <dt>Status</dt>
        <dd>{status}</dd>
        {connection?.displayName && (
          <>
            <dt>Connected account</dt>
            <dd>{connection.displayName}</dd>
          </>
        )}
        {connection?.externalAccountId && (
          <>
            <dt>External account/Page ID</dt>
            <dd>{connection.externalAccountId}</dd>
          </>
        )}
        {connection?.accountType && (
          <>
            <dt>Account type</dt>
            <dd>{connection.accountType}</dd>
          </>
        )}
        {connection?.grantedScopes && connection.grantedScopes.length > 0 && (
          <>
            <dt>Granted scopes</dt>
            <dd>{connection.grantedScopes.join(", ")}</dd>
          </>
        )}
        <dt>Last verified</dt>
        <dd>{formatTimestamp(connection?.lastVerifiedAt)}</dd>
      </dl>

      {(connection?.safeErrorMessage || errorMessage) && (
        <p style={{ color: "var(--color-danger)" }}>{resolveDisplayedErrorMessage(errorMessage, connection?.safeErrorMessage)}</p>
      )}
      {!errorMessage && !connection?.safeErrorMessage && successMessage && (
        <p style={{ color: "var(--color-success)" }}>{successMessage}</p>
      )}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
        {actionButtons.map((action) => (
          <button
            key={action.kind}
            type="button"
            disabled={action.disabled}
            onClick={
              action.kind === "connect" || action.kind === "reconnect"
                ? onConnect
                : action.kind === "verify"
                  ? onVerify
                  : action.kind === "disconnect"
                    ? onDisconnect
                    : action.kind === "reset"
                      ? onReset
                      : undefined
            }
          >
            {action.label}
          </button>
        ))}
      </div>

      {extra}
    </section>
  );
}

export default function MainDashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>("connections");
  const [connections, setConnections] = useState<PlatformConnection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [actionSuccess, setActionSuccess] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);

  const [facebookPageOptions, setFacebookPageOptions] = useState<FacebookPageOption[] | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string>("");

  const [setupModal, setSetupModal] = useState<{ platform: OAuthPlatform; missingVariables: string[] } | null>(
    null,
  );

  async function load(): Promise<void> {
    try {
      const body = await apiFetch<{ connections: PlatformConnection[] }>("/api/connections");
      setConnections(body.connections);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load connections.");
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectionPlatform = params.get("connection");
    const result = params.get("result");
    if (connectionPlatform && result) {
      const label =
        connectionPlatform === "facebook"
          ? "Facebook Account"
          : connectionPlatform === "instagram"
            ? "Instagram"
            : "Pinterest";
      setBanner(`${label} connection result: ${result}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
    void load();
  }, []);

  // One failed action only ever touches its own connectionId's error/
  // success state and re-fetches the shared list afterward — it never
  // mutates another card's already-loaded data, so one platform's
  // failure cannot affect another connection area.
  async function runAction(connectionId: string, action: () => Promise<unknown>, successMessage: string) {
    setBusyConnectionId(connectionId);
    setActionErrors((prev) => ({ ...prev, [connectionId]: "" }));
    setActionSuccess((prev) => ({ ...prev, [connectionId]: "" }));
    try {
      await action();
      setActionSuccess((prev) => ({ ...prev, [connectionId]: successMessage }));
    } catch (error) {
      setActionErrors((prev) => ({
        ...prev,
        [connectionId]: error instanceof Error ? error.message : "The action failed.",
      }));
    } finally {
      setBusyConnectionId(null);
      await load();
    }
  }

  function resetConnectionAttempt(connectionId: string) {
    return runAction(
      connectionId,
      () => apiFetch(`/api/connections/${connectionId}/reset`, { method: "POST" }),
      "Connection attempt reset.",
    );
  }

  async function loadFacebookPages() {
    setBusyConnectionId(CONNECTION_IDS.facebookPage);
    setActionErrors((prev) => ({ ...prev, [CONNECTION_IDS.facebookPage]: "" }));
    try {
      const body = await apiFetch<{ pages: FacebookPageOption[] }>("/api/connections/facebook/pages");
      setFacebookPageOptions(body.pages);
      setSelectedPageId(body.pages[0]?.id ?? "");
    } catch (error) {
      setActionErrors((prev) => ({
        ...prev,
        [CONNECTION_IDS.facebookPage]: error instanceof Error ? error.message : "The action failed.",
      }));
    } finally {
      setBusyConnectionId(null);
    }
  }

  // Checks local-development environment status before navigating to a
  // real OAuth start route. In production (or if the check itself is
  // unavailable), this silently falls back to the exact same direct
  // navigation as before — the setup modal is a local-dev convenience
  // layered on top of, never a replacement for, the real connect route.
  async function attemptConnect(platform: OAuthPlatform) {
    const connectPath = OAUTH_CONNECT_PATHS[platform];
    try {
      const status = await apiFetch<EnvironmentStatusResponse>("/api/local-setup/environment-status");
      const missing = PLATFORM_REQUIRED_VARIABLES[platform].filter(
        (name) => !status.variables.find((v) => v.name === name)?.configured,
      );
      if (missing.length > 0) {
        setSetupModal({ platform, missingVariables: missing });
        return;
      }
    } catch {
      // Not local development (or the endpoint is unavailable) — proceed
      // with the normal connect flow exactly as it already works.
    }
    setSetupModal(null);
    window.location.href = connectPath;
  }

  const isDataImportEnabled = (connections ?? []).some((connection) => isEligibleDataImportSource(connection));
  const findConnection = (connectionId: string) => connections?.find((c) => c.connectionId === connectionId);

  const instagram = findConnection(CONNECTION_IDS.instagram);
  const facebookAccount = findConnection(CONNECTION_IDS.facebookAccount);
  const facebookPage = findConnection(CONNECTION_IDS.facebookPage);
  const pinterest = findConnection(CONNECTION_IDS.pinterest);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <h1>Main Dashboard</h1>

      {banner && <p style={{ color: "var(--color-accent)" }}>{banner}</p>}
      {loadError && <p style={{ color: "var(--color-danger)" }}>{loadError}</p>}

      <nav style={{ display: "flex", gap: "1rem", borderBottom: "1px solid var(--color-border)", marginBottom: "1.5rem" }}>
        <button
          type="button"
          onClick={() => setActiveTab("connections")}
          style={{
            border: "none",
            borderBottom: activeTab === "connections" ? "2px solid var(--color-accent)" : "2px solid transparent",
            borderRadius: 0,
            background: "transparent",
            padding: "0.5rem 0",
          }}
        >
          Account Connections
        </button>
        <button
          type="button"
          onClick={() => isDataImportEnabled && setActiveTab("import")}
          disabled={!isDataImportEnabled}
          style={{
            border: "none",
            borderBottom: activeTab === "import" ? "2px solid var(--color-accent)" : "2px solid transparent",
            borderRadius: 0,
            background: "transparent",
            padding: "0.5rem 0",
          }}
        >
          Data Import
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("performance")}
          style={{
            border: "none",
            borderBottom: activeTab === "performance" ? "2px solid var(--color-accent)" : "2px solid transparent",
            borderRadius: 0,
            background: "transparent",
            padding: "0.5rem 0",
          }}
        >
          Content Performance
        </button>
      </nav>

      {connections === null && !loadError && <p>Loading connection state…</p>}

      {connections !== null && activeTab === "connections" && (
        <div>
          <ConnectionCard
            title="Instagram"
            connection={instagram}
            busy={busyConnectionId === CONNECTION_IDS.instagram}
            errorMessage={actionErrors[CONNECTION_IDS.instagram]}
            successMessage={actionSuccess[CONNECTION_IDS.instagram]}
            onConnect={() => void attemptConnect("instagram")}
            onVerify={() =>
              runAction(
                CONNECTION_IDS.instagram,
                () => apiFetch(`/api/connections/${CONNECTION_IDS.instagram}/verify`, { method: "POST" }),
                "Instagram verified.",
              )
            }
            onDisconnect={() =>
              runAction(
                CONNECTION_IDS.instagram,
                () => apiFetch("/api/connections/instagram/disconnect", { method: "POST" }),
                "Instagram disconnected.",
              )
            }
            onReset={() => void resetConnectionAttempt(CONNECTION_IDS.instagram)}
          />

          <ConnectionCard
            title="Facebook Account"
            subtitle="Authorization only — used to discover managed Pages. Meta does not provide personal-profile content or performance metrics through this connection, so it is not a Data Import source."
            connection={facebookAccount}
            busy={busyConnectionId === CONNECTION_IDS.facebookAccount}
            errorMessage={actionErrors[CONNECTION_IDS.facebookAccount]}
            successMessage={actionSuccess[CONNECTION_IDS.facebookAccount]}
            onConnect={() => void attemptConnect("facebook")}
            onVerify={() =>
              runAction(
                CONNECTION_IDS.facebookAccount,
                () => apiFetch(`/api/connections/${CONNECTION_IDS.facebookAccount}/verify`, { method: "POST" }),
                "Facebook Account verified.",
              )
            }
            onDisconnect={() =>
              runAction(
                CONNECTION_IDS.facebookAccount,
                () => apiFetch("/api/connections/facebook/disconnect", { method: "POST" }),
                "Facebook Account disconnected.",
              )
            }
            onReset={() => void resetConnectionAttempt(CONNECTION_IDS.facebookAccount)}
          />

          <ConnectionCard
            title="Facebook Page"
            connection={facebookPage}
            busy={busyConnectionId === CONNECTION_IDS.facebookPage}
            errorMessage={actionErrors[CONNECTION_IDS.facebookPage]}
            successMessage={actionSuccess[CONNECTION_IDS.facebookPage]}
            onVerify={() =>
              runAction(
                CONNECTION_IDS.facebookPage,
                () => apiFetch(`/api/connections/${CONNECTION_IDS.facebookPage}/verify`, { method: "POST" }),
                "Facebook Page verified.",
              )
            }
            onDisconnect={() =>
              runAction(
                CONNECTION_IDS.facebookPage,
                () => apiFetch("/api/connections/facebook/pages/disconnect", { method: "POST" }),
                "Facebook Page disconnected.",
              )
            }
            onConnect={facebookAccount?.status === "connected" ? () => void loadFacebookPages() : undefined}
            connectLabel="Select Facebook Page"
            connectDisabledReason={
              facebookAccount?.status !== "connected" ? "Connect Facebook Account First" : undefined
            }
            extra={
              facebookPageOptions && (
                <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <select value={selectedPageId} onChange={(event) => setSelectedPageId(event.target.value)}>
                    {facebookPageOptions.length === 0 && <option value="">No managed Pages found</option>}
                    {facebookPageOptions.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!selectedPageId || busyConnectionId === CONNECTION_IDS.facebookPage}
                    onClick={() =>
                      runAction(
                        CONNECTION_IDS.facebookPage,
                        async () => {
                          await apiFetch("/api/connections/facebook/pages/select", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ pageId: selectedPageId }),
                          });
                          setFacebookPageOptions(null);
                        },
                        "Facebook Page selected and connected.",
                      )
                    }
                  >
                    Save Page
                  </button>
                </div>
              )
            }
          />

          <ConnectionCard
            title="Pinterest"
            connection={pinterest}
            busy={busyConnectionId === CONNECTION_IDS.pinterest}
            errorMessage={actionErrors[CONNECTION_IDS.pinterest]}
            successMessage={actionSuccess[CONNECTION_IDS.pinterest]}
            onConnect={() => void attemptConnect("pinterest")}
            onVerify={() =>
              runAction(
                CONNECTION_IDS.pinterest,
                () => apiFetch(`/api/connections/${CONNECTION_IDS.pinterest}/verify`, { method: "POST" }),
                "Pinterest verified.",
              )
            }
            onDisconnect={() =>
              runAction(
                CONNECTION_IDS.pinterest,
                () => apiFetch("/api/connections/pinterest/disconnect", { method: "POST" }),
                "Pinterest disconnected.",
              )
            }
            onReset={() => void resetConnectionAttempt(CONNECTION_IDS.pinterest)}
          />
        </div>
      )}

      {connections !== null && activeTab === "import" && (
        <div>
          {isDataImportEnabled ? (
            <DataImportPanel connections={connections} />
          ) : (
            <p>Connect at least one account before importing data.</p>
          )}
        </div>
      )}

      {connections !== null && activeTab === "performance" && (
        <div>
          <PerformanceView />
        </div>
      )}

      {setupModal && (
        <LocalSetupModal
          platformLabel={OAUTH_PLATFORM_LABELS[setupModal.platform]}
          missingVariables={setupModal.missingVariables}
          onClose={() => setSetupModal(null)}
          onConfigured={() => void attemptConnect(setupModal.platform)}
        />
      )}
    </main>
  );
}
