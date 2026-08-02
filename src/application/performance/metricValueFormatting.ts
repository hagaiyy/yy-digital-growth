import { NATIVE_UNIT_SUFFIX } from "@/application/performance/labels";

// Display-only: never touches what is stored. A metric whose nativeUnit
// is "milliseconds" is shown in seconds, one digit after the decimal —
// every other unit is unaffected. `value` is only ever a real,
// persisted number here; a missing/empty/unsupported/untested metric
// has value `null` upstream and must never reach this function as if
// it were a real zero (callers gate on status first — see
// PerformanceTable's isValueBearing check).
export function formatMetricDisplayValue(value: number | string | null | undefined, nativeUnit: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number" && nativeUnit === "milliseconds") {
    return `${(value / 1000).toFixed(1)} s`;
  }
  const suffix = NATIVE_UNIT_SUFFIX[nativeUnit] ?? "";
  return suffix ? `${value} ${suffix}` : String(value);
}

// A metric name ending in "Ms" (this codebase's own naming convention
// for a millisecond-unit metric — averageWatchTimeMs, totalWatchTimeMs)
// drops that suffix from its display label once the value itself is
// already shown in seconds, so the label never contradicts the unit
// actually on screen.
export function stripMillisecondLabelSuffix(label: string, nativeUnit: string): string {
  if (nativeUnit !== "milliseconds") return label;
  return label.replace(/ Ms$/, "");
}
