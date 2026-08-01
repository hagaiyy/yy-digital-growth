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
  (some were), `unavailable` (none were, but an attempt was made), or
  `untested` (there was no live-verified or documented candidate metric
  to even attempt — e.g. a content type with no capability test yet).
- `accountType`, `contentType`, `providerMediaType`,
  `providerMediaProductType`, and `metricRecords` are additive, optional
  fields populated only by Instagram's structured metric pipeline
  (`InstagramConnector.fetchContentMetrics`). Facebook and Pinterest
  snapshots omit them entirely — no migration was needed, and reading an
  existing snapshot from before these fields existed is safe as-is.
  `metricRecords` is the structured, per-metric alternative to the flat
  `metrics` object: each entry keeps Meta's own metric name distinct
  from the internal one, the native unit distinct from any normalized
  unit, and a closed `status` instead of collapsing every non-success
  case into "missing" — see `account_performance_snapshot`'s README for
  the shared status vocabulary.
