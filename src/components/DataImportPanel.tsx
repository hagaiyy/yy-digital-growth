"use client";

import { useEffect, useState } from "react";

import type { PlatformConnection } from "@/domain/models/PlatformConnection";
import type { DataImportSettings } from "@/domain/models/DataImportSettings";
import type { ImportRun } from "@/domain/models/ImportRun";
import type { ImportedContent } from "@/domain/models/ImportedContent";
import type { PerformanceSnapshot } from "@/domain/models/PerformanceSnapshot";

interface ImportedContentListItem extends ImportedContent {
  latestPerformance: PerformanceSnapshot | null;
}

const CONNECTION_LABELS: Record<string, string> = {
  connection_instagram_primary: "Instagram",
  connection_facebook_account_primary: "Facebook Account",
  connection_facebook_page_primary: "Facebook Page",
  connection_pinterest_primary: "Pinterest",
};

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: { code: string; message: string } })
    | null;
  if (!response.ok) {
    throw new Error(body?.error?.message ?? "The request failed.");
  }
  return body as T;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US");
}

function contentLabel(item: ImportedContent): string {
  if (item.title) return item.title;
  if (item.caption) return item.caption.length > 80 ? `${item.caption.slice(0, 80)}…` : item.caption;
  return item.externalContentId;
}

function MetricsList({ metrics }: { metrics: Record<string, unknown> }) {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return <span>No metrics available.</span>;
  return (
    <span>
      {entries
        .map(([key, value]) => `${key}: ${value === null ? "unavailable" : String(value)}`)
        .join(" · ")}
    </span>
  );
}

export function DataImportPanel({ connections }: { connections: PlatformConnection[] }) {
  const [settings, setSettings] = useState<DataImportSettings | null>(null);
  const [limitInput, setLimitInput] = useState<string>("");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [latestRun, setLatestRun] = useState<ImportRun | null>(null);
  const [runInProgress, setRunInProgress] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const [items, setItems] = useState<ImportedContentListItem[] | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);

  async function loadSettings(): Promise<void> {
    try {
      const body = await apiFetch<{ settings: DataImportSettings }>("/api/data-import/settings");
      setSettings(body.settings);
      setLimitInput(String(body.settings.recentContentLimit));
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Failed to load settings.");
    }
  }

  async function loadLatestRun(): Promise<void> {
    try {
      const body = await apiFetch<{ importRun: ImportRun | null }>("/api/data-import/runs/latest");
      setLatestRun(body.importRun);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Failed to load the latest import run.");
    }
  }

  async function loadItems(): Promise<void> {
    try {
      const body = await apiFetch<{ items: ImportedContentListItem[] }>("/api/imported-content");
      setItems(body.items);
      setItemsError(null);
    } catch (error) {
      setItemsError(error instanceof Error ? error.message : "Failed to load imported content.");
    }
  }

  useEffect(() => {
    void loadSettings();
    void loadLatestRun();
    void loadItems();
  }, []);

  async function saveLimit() {
    const parsed = Number(limitInput);
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const body = await apiFetch<{ settings: DataImportSettings }>("/api/data-import/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recentContentLimit: parsed }),
      });
      setSettings(body.settings);
      setLimitInput(String(body.settings.recentContentLimit));
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Failed to save Recent Content Limit.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function startImport() {
    setRunInProgress(true);
    setRunError(null);
    try {
      const body = await apiFetch<{ importRun: ImportRun }>("/api/data-import/run", { method: "POST" });
      setLatestRun(body.importRun);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "The import failed to start.");
    } finally {
      setRunInProgress(false);
      // Always re-fetch from MongoDB after an import attempt — the
      // interface never renders imported items directly from the
      // platform response, only what was actually persisted.
      await loadLatestRun();
      await loadItems();
    }
  }

  const eligibleConnections = connections.filter((c) => c.status === "connected");

  return (
    <div>
      <section style={{ marginBottom: "1.5rem" }}>
        <h3>Connected sources eligible for import</h3>
        {eligibleConnections.length === 0 ? (
          <p>No connected sources.</p>
        ) : (
          <ul>
            {eligibleConnections.map((connection) => (
              <li key={connection.connectionId}>
                {CONNECTION_LABELS[connection.connectionId] ?? connection.platform}
                {connection.displayName ? ` — ${connection.displayName}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h3>Recent Content Limit</h3>
        <p>How many recent items to request from each connected source (1–100).</p>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="number"
            min={1}
            max={100}
            value={limitInput}
            onChange={(event) => setLimitInput(event.target.value)}
            style={{ width: "5rem" }}
          />
          <button type="button" onClick={() => void saveLimit()} disabled={savingSettings || !settings}>
            Save
          </button>
        </div>
        {settingsError && <p style={{ color: "#ff8080" }}>{settingsError}</p>}
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <button
          type="button"
          onClick={() => void startImport()}
          disabled={runInProgress || eligibleConnections.length === 0}
        >
          Import Data
        </button>
        {runInProgress && <p>Importing…</p>}
        {runError && <p style={{ color: "#ff8080" }}>{runError}</p>}
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h3>Last import summary</h3>
        {!latestRun && <p>No import has run yet.</p>}
        {latestRun && (
          <div>
            <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.15rem 0.75rem" }}>
              <dt>Status</dt>
              <dd>{latestRun.status}</dd>
              <dt>Started</dt>
              <dd>{formatTimestamp(latestRun.startedAt)}</dd>
              <dt>Completed</dt>
              <dd>{formatTimestamp(latestRun.completedAt)}</dd>
              <dt>Recent Content Limit used</dt>
              <dd>{latestRun.recentContentLimit}</dd>
              <dt>Connections</dt>
              <dd>{latestRun.totals.connections}</dd>
              <dt>Requested items</dt>
              <dd>{latestRun.totals.requestedItems}</dd>
              <dt>Created</dt>
              <dd>{latestRun.totals.createdItems}</dd>
              <dt>Updated</dt>
              <dd>{latestRun.totals.updatedItems}</dd>
              <dt>Failed</dt>
              <dd>{latestRun.totals.failedItems}</dd>
              <dt>Skipped</dt>
              <dd>{latestRun.totals.skippedItems}</dd>
            </dl>

            {latestRun.safeErrorMessage && (
              <p style={{ color: "#ff8080" }}>{latestRun.safeErrorMessage}</p>
            )}

            <h4>Per-connection results</h4>
            {latestRun.connectionResults.map((result) => (
              <div
                key={result.connectionId}
                style={{ border: "1px solid #333", borderRadius: 4, padding: "0.5rem 0.75rem", marginBottom: "0.5rem" }}
              >
                <p style={{ margin: "0.25rem 0" }}>
                  <strong>{CONNECTION_LABELS[result.connectionId] ?? result.platform}</strong> — {result.status}
                  {typeof result.requestedCount === "number" && (
                    <>
                      {" "}
                      (requested {result.requestedCount}, created {result.createdCount ?? 0}, updated{" "}
                      {result.updatedCount ?? 0}, failed {result.failedCount ?? 0}, skipped {result.skippedCount ?? 0})
                    </>
                  )}
                </p>
                {result.safeErrorMessage && <p style={{ color: "#ffcf80" }}>{result.safeErrorMessage}</p>}
                {result.itemResults && result.itemResults.length > 0 && (
                  <ul>
                    {result.itemResults.map((item, index) => (
                      <li key={`${item.externalContentId ?? index}`}>
                        [{item.status}] {item.contentLabel ?? item.externalContentId ?? "unknown item"}
                        {item.safeMessage ? ` — ${item.safeMessage}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3>Imported content</h3>
        {itemsError && <p style={{ color: "#ff8080" }}>{itemsError}</p>}
        {items === null && !itemsError && <p>Loading imported content…</p>}
        {items !== null && items.length === 0 && <p>No content has been imported yet.</p>}
        {items !== null && items.length > 0 && (
          <div>
            {items.map((item) => (
              <div
                key={item.importedContentId}
                style={{ border: "1px solid #333", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "0.75rem" }}
              >
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  {item.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.thumbnailUrl} alt="" width={80} height={80} style={{ objectFit: "cover" }} />
                  )}
                  <div>
                    <p style={{ margin: "0 0 0.25rem" }}>
                      <strong>{item.platform}</strong> · {item.contentType} · {contentLabel(item)}
                    </p>
                    <p style={{ margin: "0 0 0.25rem" }}>Published: {formatTimestamp(item.publishedAt)}</p>
                    {item.permalink && (
                      <p style={{ margin: "0 0 0.25rem" }}>
                        <a href={item.permalink} target="_blank" rel="noreferrer">
                          View on platform
                        </a>
                      </p>
                    )}
                    <p style={{ margin: "0 0 0.25rem" }}>
                      Latest metrics:{" "}
                      {item.latestPerformance ? (
                        <MetricsList metrics={item.latestPerformance.metrics} />
                      ) : (
                        "No metrics collected yet."
                      )}
                    </p>
                    {item.latestPerformance && (
                      <p style={{ margin: "0 0 0.25rem" }}>
                        Data completeness: {item.latestPerformance.dataCompleteness}
                      </p>
                    )}
                    <p style={{ margin: 0 }}>Last imported: {formatTimestamp(item.lastImportedAt)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
