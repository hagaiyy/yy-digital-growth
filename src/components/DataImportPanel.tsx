"use client";

import { useEffect, useState } from "react";

import { isEligibleDataImportSource, type PlatformConnection } from "@/domain/models/PlatformConnection";
import type { DataImportSettings } from "@/domain/models/DataImportSettings";
import type { ImportRun } from "@/domain/models/ImportRun";
import type { ImportedContent } from "@/domain/models/ImportedContent";
import type { PerformanceSnapshot } from "@/domain/models/PerformanceSnapshot";
import type { AccountPerformanceSnapshot } from "@/domain/models/AccountPerformanceSnapshot";
import { CONNECTION_IDS } from "@/domain/connectionIds";
import { CONNECTION_LABELS } from "@/components/connectionLabels";
import { ImportStatusIndicator } from "@/components/ImportStatusIndicator";

interface ImportedContentListItem extends ImportedContent {
  latestPerformance: PerformanceSnapshot | null;
}

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

function AccountSnapshotsSection({
  title,
  description,
  snapshots,
  error,
}: {
  title: string;
  description: string;
  snapshots: AccountPerformanceSnapshot[] | null;
  error: string | null;
}) {
  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h3>{title}</h3>
      <p>{description}</p>
      {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}
      {snapshots === null && !error && <p>Loading…</p>}
      {snapshots !== null && snapshots.length === 0 && <p>No insights have been collected yet.</p>}
      {snapshots !== null && snapshots.length > 0 && (
        <div>
          {snapshots.map((snapshot, index) => (
            <div
              key={`${snapshot.period}-${snapshot.timeframe ?? snapshot.since ?? index}`}
              style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "0.75rem" }}
            >
              <p style={{ margin: "0 0 0.25rem" }}>
                <strong>period: {snapshot.period}</strong>
                {snapshot.timeframe ? ` · timeframe: ${snapshot.timeframe}` : ""}
                {snapshot.since ? ` · since: ${formatTimestamp(snapshot.since)}` : ""}
                {snapshot.until ? ` · until: ${formatTimestamp(snapshot.until)}` : ""}
                {" · completeness: "}
                {snapshot.completeness}
              </p>
              <ul style={{ margin: "0 0 0.25rem" }}>
                {snapshot.metrics.map((metric, metricIndex) => (
                  <li key={`${metric.internalMetric}-${metricIndex}`}>
                    {metric.internalMetric}: {metric.value === null ? "unavailable" : String(metric.value)}
                    {" "}
                    [{metric.status}
                    {metric.unavailableDueToAccountSize ? ", limited by account size" : ""}]
                  </li>
                ))}
              </ul>
              <p style={{ margin: 0 }}>Collected: {formatTimestamp(snapshot.collectedAt)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
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

  const [accountSnapshots, setAccountSnapshots] = useState<AccountPerformanceSnapshot[] | null>(null);
  const [accountSnapshotsError, setAccountSnapshotsError] = useState<string | null>(null);

  const [facebookPageSnapshots, setFacebookPageSnapshots] = useState<AccountPerformanceSnapshot[] | null>(null);
  const [facebookPageSnapshotsError, setFacebookPageSnapshotsError] = useState<string | null>(null);

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

  async function loadAccountSnapshots(): Promise<void> {
    try {
      const body = await apiFetch<{ snapshots: AccountPerformanceSnapshot[] }>(
        `/api/connections/${CONNECTION_IDS.instagram}/account-performance`,
      );
      setAccountSnapshots(body.snapshots);
      setAccountSnapshotsError(null);
    } catch (error) {
      setAccountSnapshotsError(
        error instanceof Error ? error.message : "Failed to load Instagram account-level insights.",
      );
    }
  }

  async function loadFacebookPageSnapshots(): Promise<void> {
    try {
      const body = await apiFetch<{ snapshots: AccountPerformanceSnapshot[] }>(
        `/api/connections/${CONNECTION_IDS.facebookPage}/account-performance`,
      );
      setFacebookPageSnapshots(body.snapshots);
      setFacebookPageSnapshotsError(null);
    } catch (error) {
      setFacebookPageSnapshotsError(
        error instanceof Error ? error.message : "Failed to load Facebook Page-level insights.",
      );
    }
  }

  useEffect(() => {
    void loadSettings();
    void loadLatestRun();
    void loadItems();
    void loadAccountSnapshots();
    void loadFacebookPageSnapshots();
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
      await loadAccountSnapshots();
      await loadFacebookPageSnapshots();
    }
  }

  const eligibleConnections = connections.filter((c) => isEligibleDataImportSource(c));

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
        {settingsError && <p style={{ color: "var(--color-danger)" }}>{settingsError}</p>}
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
        {runError && <p style={{ color: "var(--color-danger)" }}>{runError}</p>}
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <ImportStatusIndicator importRun={latestRun} />
      </section>

      <section>
        <h3>Imported content</h3>
        {itemsError && <p style={{ color: "var(--color-danger)" }}>{itemsError}</p>}
        {items === null && !itemsError && <p>Loading imported content…</p>}
        {items !== null && items.length === 0 && <p>No content has been imported yet.</p>}
        {items !== null && items.length > 0 && (
          <div>
            {items.map((item) => (
              <div
                key={item.importedContentId}
                style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "0.75rem" }}
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

      <AccountSnapshotsSection
        title="Instagram account-level insights"
        description="Audience demographics, follower counts, and profile-level activity — describes the whole account, never mixed with individual content metrics above."
        snapshots={accountSnapshots}
        error={accountSnapshotsError}
      />

      <AccountSnapshotsSection
        title="Facebook Page-level insights"
        description="Page impressions, engagement, video views, and follower activity — describes the whole Page, never mixed with individual post metrics above."
        snapshots={facebookPageSnapshots}
        error={facebookPageSnapshotsError}
      />
    </div>
  );
}
