"use client";

import { useEffect, useState } from "react";

import type { ImportRun } from "@/domain/models/ImportRun";
import type { PerformanceTabSummary } from "@/application/services/PerformanceViewService";
import { ImportStatusIndicator } from "@/components/ImportStatusIndicator";
import { PerformanceTable } from "@/components/performance/PerformanceTable";

async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = (await response.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!response.ok) {
    throw new Error(body?.error?.message ?? "The request failed.");
  }
  return body as T;
}

function tabKey(tab: PerformanceTabSummary): string {
  return `${tab.platform}:${tab.contentType}`;
}

export function PerformanceView() {
  const [tabs, setTabs] = useState<PerformanceTabSummary[] | null>(null);
  const [tabsError, setTabsError] = useState<string | null>(null);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);
  const [latestRun, setLatestRun] = useState<ImportRun | null>(null);

  useEffect(() => {
    void apiFetch<{ tabs: PerformanceTabSummary[] }>("/api/performance/tabs")
      .then((body) => {
        setTabs(body.tabs);
        setActiveTabKey((current) => current ?? (body.tabs[0] ? tabKey(body.tabs[0]) : null));
      })
      .catch((error) => setTabsError(error instanceof Error ? error.message : "Failed to load performance tabs."));

    void apiFetch<{ importRun: ImportRun | null }>("/api/data-import/runs/latest")
      .then((body) => setLatestRun(body.importRun))
      .catch(() => {
        // The compact indicator degrades to "No import has run yet" —
        // never blocks the performance table itself.
      });
  }, []);

  const activeTab = tabs?.find((tab) => tabKey(tab) === activeTabKey) ?? null;

  return (
    <div>
      <div style={{ marginBottom: "1.25rem" }}>
        <ImportStatusIndicator importRun={latestRun} />
      </div>

      {tabsError && <p className="text-danger">{tabsError}</p>}
      {!tabs && !tabsError && <p>Loading content performance…</p>}

      {tabs && tabs.length === 0 && <p>No content has been imported yet. Run a Data Import to see performance here.</p>}

      {tabs && tabs.length > 0 && (
        <>
          <nav className="tab-nav">
            {tabs.map((tab) => {
              const key = tabKey(tab);
              return (
                <button
                  key={key}
                  type="button"
                  className={`tab-button ${key === activeTabKey ? "tab-button-active" : ""}`}
                  onClick={() => setActiveTabKey(key)}
                >
                  {tab.label}
                  <span className="tab-count">{tab.itemCount}</span>
                </button>
              );
            })}
          </nav>

          {activeTab && <PerformanceTable platform={activeTab.platform} contentType={activeTab.contentType} />}
        </>
      )}
    </div>
  );
}
