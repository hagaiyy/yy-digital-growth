"use client";

import { useRef, useState } from "react";

const TOOLTIP_WIDTH = 280;
const CLOSE_DELAY_MS = 150;

// A small, focusable info/warning trigger that reveals the full safe
// explanation for a metric in a tooltip instead of inline in the table
// — hover or keyboard focus opens it, and a Copy button inside lets the
// exact message be copied verbatim. The row itself never grows to fit
// this text; only the floating tooltip does.
export function MetricIssueIndicator({ message, metricLabel }: { message: string; metricLabel: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelScheduledClose() {
    if (closeTimeoutRef.current !== null) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }

  function openTooltip() {
    cancelScheduledClose();
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      // Clamped so the tooltip never renders off-screen regardless of
      // where the icon sits in a wide, horizontally-scrollable table.
      const left = Math.min(Math.max(rect.left, 8), window.innerWidth - TOOLTIP_WIDTH - 8);
      setPosition({ top: rect.bottom + 6, left });
    }
    setOpen(true);
  }

  function scheduleClose() {
    cancelScheduledClose();
    closeTimeoutRef.current = setTimeout(() => {
      setOpen(false);
      setCopied(false);
    }, CLOSE_DELAY_MS);
  }

  function handleWrapperBlur(event: React.FocusEvent) {
    if (!wrapperRef.current?.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
      setCopied(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail (unsupported/insecure context) — the
      // message is still fully readable in the open tooltip either way.
    }
  }

  return (
    <span
      className="metric-issue"
      ref={wrapperRef}
      onMouseEnter={cancelScheduledClose}
      onMouseLeave={scheduleClose}
      onBlur={handleWrapperBlur}
    >
      <button
        type="button"
        ref={buttonRef}
        className="metric-issue-trigger"
        aria-label={`More information about ${metricLabel}`}
        aria-describedby={open ? "metric-issue-tooltip" : undefined}
        onMouseEnter={openTooltip}
        onFocus={openTooltip}
      >
        !
      </button>
      {open && position && (
        <span id="metric-issue-tooltip" role="tooltip" className="metric-issue-tooltip" style={{ top: position.top, left: position.left }}>
          <span className="metric-issue-tooltip-text">{message}</span>
          <button type="button" className="btn btn-secondary btn-small metric-issue-copy" onClick={() => void handleCopy()}>
            {copied ? "Copied" : "Copy"}
          </button>
        </span>
      )}
    </span>
  );
}
