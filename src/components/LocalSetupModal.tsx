"use client";

import { useState } from "react";

import { getLocalSetupVariable } from "@/config/localSetupVariables";

interface LocalSetupModalProps {
  platformLabel: string;
  missingVariables: string[];
  onClose: () => void;
  onConfigured: () => void;
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

export function LocalSetupModal({
  platformLabel,
  missingVariables,
  onClose,
  onConfigured,
}: LocalSetupModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const name of missingVariables) {
      const def = getLocalSetupVariable(name);
      if (def?.defaultValue) initial[name] = def.defaultValue;
    }
    return initial;
  });
  const [resolvedByGeneration, setResolvedByGeneration] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pendingVariables = missingVariables.filter((name) => !resolvedByGeneration.has(name));

  async function handleGenerateKey() {
    setGenerating(true);
    setError(null);
    try {
      const result = await apiFetch<{ restartRequired: boolean }>(
        "/api/local-setup/generate-encryption-key",
        { method: "POST" },
      );
      setResolvedByGeneration((prev) => new Set(prev).add("APP_ENCRYPTION_KEY"));
      if (result.restartRequired) {
        setRestartRequired(true);
        setSavedMessage("Encryption key generated. Restart the development server to apply the changes.");
      } else if (pendingVariables.length === 1) {
        // That was the only missing variable and the server already sees it.
        onConfigured();
      } else {
        setSavedMessage("Encryption key generated.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate the key.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const toSubmit = pendingVariables.filter((name) => name !== "APP_ENCRYPTION_KEY");
      const missingRequired = toSubmit.filter((name) => !values[name]?.trim());
      if (missingRequired.length > 0) {
        throw new Error(`Please fill in: ${missingRequired.join(", ")}.`);
      }
      if (toSubmit.length > 0) {
        const payload: Record<string, string> = {};
        for (const name of toSubmit) payload[name] = values[name]!;
        const result = await apiFetch<{ restartRequired: boolean }>("/api/local-setup/environment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values: payload }),
        });
        if (result.restartRequired) {
          setRestartRequired(true);
          setSavedMessage("Configuration saved. Restart the development server to apply the changes.");
          return;
        }
      }
      // Either nothing left to submit (all resolved via generation) or the
      // live server already sees the new values — retry the connection.
      onConfigured();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save configuration.");
    } finally {
      setSaving(false);
    }
  }

  function handleCopyRestartCommand() {
    void navigator.clipboard.writeText("npm run dev").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "#111",
          border: "1px solid #333",
          borderRadius: 8,
          padding: "1.5rem",
          maxWidth: 480,
          width: "90%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "#9ad1ff", textTransform: "uppercase" }}>
          Local Development Setup
        </p>
        <h2 style={{ marginTop: 0 }}>Platform: {platformLabel}</h2>
        <p>
          This connection needs application configuration that isn&apos;t set yet. Fill in the values
          below; they will be written to your local <code>.env.local</code> file only.
        </p>

        <p style={{ fontWeight: "bold", marginBottom: "0.25rem" }}>Missing configuration:</p>

        {pendingVariables.map((name) => {
          const def = getLocalSetupVariable(name);
          if (!def) return null;

          if (name === "APP_ENCRYPTION_KEY") {
            return (
              <div key={name} style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.25rem" }}>{def.label}</label>
                <p style={{ fontSize: "0.85rem", color: "#aaa", margin: "0 0 0.5rem" }}>{def.description}</p>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <button type="button" onClick={() => void handleGenerateKey()} disabled={generating}>
                    {generating ? "Generating..." : "Generate Secure Key"}
                  </button>
                  <span>or</span>
                  <input
                    type="password"
                    placeholder="Enter manually"
                    value={values[name] ?? ""}
                    onChange={(event) => setValues((prev) => ({ ...prev, [name]: event.target.value }))}
                    style={{ flex: 1, minWidth: "10rem" }}
                  />
                </div>
              </div>
            );
          }

          return (
            <div key={name} style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem" }}>
                {def.label} <code>({name})</code>
              </label>
              <input
                type={def.secret ? "password" : "text"}
                value={values[name] ?? ""}
                onChange={(event) => setValues((prev) => ({ ...prev, [name]: event.target.value }))}
                style={{ width: "100%" }}
              />
              <p style={{ fontSize: "0.85rem", color: "#aaa", margin: "0.25rem 0 0" }}>{def.description}</p>
            </div>
          );
        })}

        {error && <p style={{ color: "#ff8080" }}>{error}</p>}
        {savedMessage && <p style={{ color: "#8adf8a" }}>{savedMessage}</p>}

        {restartRequired && (
          <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" onClick={handleCopyRestartCommand}>
              {copied ? "Copied!" : "Copy Restart Command"}
            </button>
            <button type="button" onClick={onConfigured}>
              Retry Connection
            </button>
          </div>
        )}

        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
          {!restartRequired && (
            <button type="button" onClick={() => void handleSave()} disabled={saving || generating}>
              {saving ? "Saving..." : "Save Configuration"}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
