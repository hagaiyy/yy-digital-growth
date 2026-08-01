# Current Scope — Account Connections and Data Import

## MVP purpose

YY Digital Growth will eventually connect to social-platform accounts,
import recent published content and available performance data,
persist it in MongoDB, display only persisted data, and later compare
performance and generate improvement recommendations. This document
covers the first two of those steps.

## What has been implemented

### Account Connections

- **Main Dashboard** (`/`) with two tabs: **Account Connections**
  (default) and **Data Import**.
- Four connection areas — Instagram, Facebook Account, Facebook Page,
  Pinterest — each showing status, connected account name, external
  account/Page ID, account type, granted scopes, last verified time,
  and a safe error message when relevant, with a Connect / Verify /
  Reconnect / Disconnect action.
- Persistent connection state in MongoDB (`platformConnections`),
  surviving browser refresh, closing the browser, and server restarts.
- Encrypted, server-only credential storage (`platformCredentials`),
  separate from the public connection record.
- Real OAuth flows for Facebook (Account authorization + managed-Page
  discovery + explicit Page selection), Pinterest (authorization code +
  refresh support at the service boundary), and Instagram (authorization
  code via Instagram API with Instagram Login, authorized directly
  against Instagram — separate `INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET`
  credentials from the Facebook connection, no Facebook Page involved).
  None of the three ever asks the user to supply or paste an access
  token — every credential comes from completing the interactive
  authorization flow.

### Data Import

- **Data Import gating**: the tab is disabled ("Connect at least one
  account before importing data.") until at least one connection has
  status `connected`.
- **Import Data** button starts one user action; the server imports
  from every connected and supported source (Instagram, Facebook Page,
  Pinterest), each isolated so one failure never stops the others.
  Facebook Account is always reported `unsupported` — the Graph API
  does not provide personal-profile content or analytics to standard
  apps.
- **Recent Content Limit** (default 30, range 1–100), persisted in
  MongoDB (`dataImportSettings`) so it survives a restart.
- Imported content (`importedContents`) and hourly performance
  snapshots (`performanceSnapshots`) are persisted per item, deduplicated
  by `platform` + `externalContentId` and by `importedContentId` +
  `snapshotHour` respectively — repeated imports update, never
  duplicate.
- Every import creates one `importRun` recording exact per-connection
  and per-item outcomes (success/partial/failed/skipped/unsupported),
  not only aggregate counts.
- Only one import may run at a time; a second request while one is
  running gets `409 Conflict`.
- The Data Import tab always re-fetches from MongoDB after an import —
  it never renders a platform response directly.

## What is still deferred

- AI analysis
- Recommendations
- Performance explanations
- Publishing
- Scheduling
- Media upload
- Projects
- Content preparation
- Content review
- Automatic knowledge generation

## Facebook Account vs. Facebook Page

These are two separate connection targets:

- **Facebook Account** represents the authorized Facebook user. It is
  used only to verify authorization and discover managed Pages — it
  does not claim personal-profile content or analytics are available,
  and Data Import always reports it `unsupported` rather than
  attempting a request the API cannot fulfill.
- **Facebook Page** represents one Page managed by the connected
  Facebook Account, explicitly selected by the user from the Pages the
  API returns (never auto-selected, even when only one Page exists).
  Its `platformConnection` record's `parentConnectionId` points at the
  Facebook Account connection it was discovered through. Data Import
  reads this Page's posts and their available insights.

Disconnecting the Facebook Account cascades to disconnect the Facebook
Page, since the Page's authorization is rooted in the Account's
session. Disconnecting the Page alone leaves the Account connected.

## Connection and content persistence

MongoDB is the source of truth for `platformConnection`,
`importedContent`, `performanceSnapshot`, `importRun`, and
`dataImportSettings`; encrypted server-side storage is the source of
truth for credentials. Neither React state, `localStorage`,
`sessionStorage`, nor cookies are authoritative for any of this — they
are not used to store this state at all. See `docs/system-contract.md`
for the full persistence and security contract.

## Environment variables

See the table in [README.md](../README.md#environment-variables).
`.env.example` lists every variable name with an empty value;
`.env.local` is never overwritten and is git-ignored. Data Import
introduces no new environment variables.
