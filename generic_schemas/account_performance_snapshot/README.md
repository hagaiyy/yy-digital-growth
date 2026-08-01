# accountPerformanceSnapshot

One record per connected account per UTC hour of collection, per
distinct Meta request-parameter group (`period` + either `since`/`until`
or `timeframe`). MongoDB collection: `accountPerformanceSnapshots`.
Never mixed with `performanceSnapshots` — content metrics describe one
piece of content; account metrics (audience demographics, follower
counts, profile-level activity) describe the whole account and come
from a different endpoint with different parameters.

- Unique identity: `connectionId` + `snapshotHour` + `period` +
  `since`/`until` + `timeframe`. Metrics that share the same request
  parameters (e.g. all `period=day` aggregate metrics using the same
  `since`/`until` window) live together in one snapshot's `metrics[]`;
  metrics that need different parameters (e.g. `period=lifetime`
  demographics using `timeframe` instead of `since`/`until`) get their
  own snapshot for that hour.
- `metrics` is a validated array of `accountMetricRecord` entries, never
  an arbitrary object — see each record's `status` for why a metric is
  or isn't present, and `unavailableDueToAccountSize` for demographic
  metrics Meta withheld because the account is below its documented
  reporting threshold (currently 100 followers/engagements), which is
  never the same as a real zero.
- `completeness` describes the snapshot as a whole: `complete` (every
  metric expected for this parameter group came back), `partial` (some
  did), `unavailable` (an attempt was made and nothing came back), or
  `untested` (nothing in this group has ever been confirmed live).
