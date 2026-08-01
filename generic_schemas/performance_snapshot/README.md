# performanceSnapshot

One record per imported content item per UTC hour of collection.
MongoDB collection: `performanceSnapshots`.

- Unique identity: `importedContentId` + `snapshotHour` (the UTC hour,
  truncated to the hour boundary, that contains the collection time).
  A later import within the same hour updates this same record; a new
  hour creates a new one.
- `metrics` is a single flat object holding both shared, cross-platform
  metric names (see `docs/system-contract.md`) and platform-specific
  ones together — there is no separate raw/normalized split. A metric
  key that is missing was never returned by the platform; a metric
  value of `null` means the platform explicitly reported it as
  unavailable; a metric value of `0` is a real observed zero. These
  three states are never collapsed into each other.
- `dataCompleteness` describes the snapshot as a whole: `complete` (all
  metrics expected for this content type were retrieved), `partial`
  (some were), or `unavailable` (none were, but an attempt was made).
