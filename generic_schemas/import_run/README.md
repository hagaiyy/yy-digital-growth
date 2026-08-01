# importRun

One record per user-triggered import action. MongoDB collection:
`importRuns`. Exists to make an import debuggable after the fact — it
records exactly which connections and content items succeeded,
partially succeeded, failed, were skipped, or were unsupported, not
just aggregate counts.

Only one `importRun` may have `status: "running"` at a time, enforced
by a partial unique index on `importRuns.status` — a second import
request while one is running gets a `409 Conflict`, not a second run.

`safeErrorMessage` (top-level, optional) is used only when a run is
found to be stale (see `docs/system-contract.md`'s "hosting runtime
limit" note) and is marked `failed` automatically to release the lock.
