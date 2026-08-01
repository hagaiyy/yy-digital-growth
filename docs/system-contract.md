# System Contract — Account Connections and Data Import

## Domain object: platformConnection

The only public domain object in this phase. MongoDB collection:
`platformConnections`. Canonical schema:
`generic_schemas/platform_connection/platform_connection.schema.json`
(draft 2020-12, validated with Ajv).

Required fields: `schemaVersion`, `connectionId`, `platform`,
`connectionTarget`, `status`, `createdAt`, `updatedAt`.

Optional fields: `externalAccountId`, `displayName`, `accountType`,
`grantedScopes`, `connectedAt`, `lastVerifiedAt`, `expiresAt`,
`safeErrorCode`, `safeErrorMessage`, `parentConnectionId`.

`platform` ∈ `instagram | facebook | pinterest`.
`connectionTarget` ∈ `account | page`.
`status` ∈ `notConnected | setupRequired | connecting | connected |
expired | failed`.

`platformConnection` never contains credentials. The schema is
`additionalProperties: false`, so a token or secret accidentally passed
into a record fails validation rather than being silently persisted.

There are exactly four connection areas, each with a fixed
`connectionId` (`src/domain/connectionIds.ts`):

| Area | connectionId | platform | connectionTarget |
| --- | --- | --- | --- |
| Instagram | `connection_instagram_primary` | instagram | account |
| Facebook Account | `connection_facebook_account_primary` | facebook | account |
| Facebook Page | `connection_facebook_page_primary` | facebook | page |
| Pinterest | `connection_pinterest_primary` | pinterest | account |

Facebook Page is a single slot: selecting a different Page overwrites
this same record rather than creating a new one, matching "Facebook
Page" being one connection area, not a list of Pages.

`GET /api/connections` always returns all four areas. Before any action
has ever run for an area, its record is synthesized on read (not
persisted) with `status: "notConnected"` if the underlying connector is
configured, or `"setupRequired"` if it is not — so the Main Dashboard
never has to handle "no record yet" as a separate case.

## Private credential storage

Separate, private MongoDB collection: `platformCredentials`. Never
returned by any API route, never rendered in the UI. Shape
(`src/domain/models/EncryptedCredential.ts`):

```
{ connectionId, algorithm: "aes-256-gcm", iv, authTag, ciphertext, createdAt, updatedAt }
```

Encryption (`src/infrastructure/crypto/encryption.ts`) uses Node's
built-in `node:crypto` AES-256-GCM (authenticated encryption). The key
is derived by SHA-256-hashing `APP_ENCRYPTION_KEY` down to exactly 32
bytes, so the environment variable can be any format (passphrase, hex,
base64) without brittle validation. Encryption and decryption happen
only in server-side modules, never imported by the client component
(`page.tsx`) — enforced by `tests/structural/clientBoundary.test.ts`.

If `APP_ENCRYPTION_KEY` is not set, `ConnectionService` never attempts
to store a credential: every connect/verify action instead persists
`status: "setupRequired"`, and no plaintext credential is ever written.
Disconnecting a platform deletes its `platformCredentials` record.

## No fake connections

A `platformConnection` may reach `status: "connected"` only after (1) a
real external API call to the platform succeeds, (2) that call returns
an account identity, and (3) the result is persisted. Listing saved
connections (`ConnectionService.list()`) never calls any connector — it
is a pure read of MongoDB, which is what lets a returning user see
their still-valid connection without being forced through
re-authorization.

## Connectors

Each platform has one isolated connector under
`src/application/connectors/` — no shared plugin framework:

- **InstagramConnector**: interactive authorization-code OAuth via
  **Instagram API with Instagram Login** (`instagram_business_basic,
  instagram_business_manage_insights` scope, no publishing permission) —
  authorized directly against Instagram's own endpoints
  (`www.instagram.com/oauth/authorize`), never through a Facebook Page
  or Facebook Login for Business. `buildAuthorizationUrl`/
  `exchangeCodeForToken` use `INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET` —
  a separate Instagram App ID/Secret from the Meta app's own Instagram
  product settings, never `META_APP_ID`/`META_APP_SECRET` — plus their
  own `INSTAGRAM_REDIRECT_URI`. `exchangeCodeForToken` performs the
  two-step exchange Instagram API with Instagram Login requires: a
  short-lived token from `api.instagram.com/oauth/access_token`,
  immediately exchanged for a long-lived (~60 day) token via
  `graph.instagram.com/access_token`. `fetchConnectedInstagramAccount`/
  `verifyAccountStillValid` call `graph.instagram.com/me` directly with
  that access token — no Page discovery step, since the token is already
  scoped to exactly one Instagram professional account — and persist
  that access token (not a Page token) as the credential. There is no
  environment-supplied Instagram access token or account ID anywhere in
  this connector. Also fetches recent media (`fetchRecentContent`) and
  per-item insights (`fetchContentMetrics`) for Data Import, both taking
  the stored access token as a parameter, not reading from the
  environment.
- **FacebookConnector**: authorization-code OAuth (`public_profile,
  pages_show_list, pages_read_engagement, read_insights` scope — still
  no publishing permission), identity lookup, and managed-Pages
  discovery (`/me/accounts`). `pages_read_engagement`/`read_insights`
  were added in the Data Import phase so Page posts and their insights
  can be read (`fetchPageContent`/`fetchPagePostMetrics`); a Facebook
  Account connected under the previous, narrower scope must be
  reconnected. `fetchAccountContent()` never calls the Graph API at
  all — it returns an `unsupported` result immediately, since the API
  does not provide personal-profile content/analytics to standard apps.
- **PinterestConnector**: authorization-code OAuth
  (`user_accounts:read, pins:read` scope — `pins:read` added in the
  Data Import phase, requiring reconnection of any account connected
  before it), token exchange, identity lookup (`/v5/user_account`),
  refresh-token exchange, recent-Pins listing (`fetchRecentPins`), and
  per-Pin analytics (`fetchPinAnalytics`).

Connectors throw `ConnectorError` (`code: "setupRequired" |
"invalidState" | "failed"`, plus a `safeMessage`) instead of letting a
raw fetch/API error escape. `safeMessage` never contains tokens,
secrets, or request URLs, and connector code never logs the underlying
error object — only a fixed, sanitized log line — since Instagram and
Facebook pass their access token as a URL query parameter, and logging
the request or its error could otherwise leak it.

## OAuth state validation

`src/interfaces/http/oauthState.ts` generates a stateless, expiring,
HMAC-SHA256-signed state token (`base64url(payload).signature`) keyed by
`APP_ENCRYPTION_KEY`. No cookie or server-side session storage is
needed: the signature alone proves the token wasn't forged, and the
embedded `platform` + `exp` fields are checked on callback. This is
deliberately simpler than a stored-nonce + cookie double-submit scheme
while still rejecting a missing, tampered, expired, or wrong-platform
state.

## Application service

`ConnectionService` (`src/application/services/ConnectionService.ts`) is
the single narrow service responsible for: listing connection states,
retrieving one connection, starting a connection, handling an OAuth
callback, verifying a connection, reconnecting, disconnecting, and
determining whether Data Import is enabled
(`isDataImportEnabled(): some connection has status "connected"`). It
depends on the two repositories and the three connectors through
constructor injection, so tests substitute in-memory fakes
(`tests/fakes/`) without touching MongoDB or the network.

`MongoPlatformConnectionRepository.upsert` uses `replaceOne`, not
`updateOne` + `$set`: callers always pass a complete record, and
optional fields intentionally omitted (e.g. cleared on disconnect) must
actually disappear from the stored document rather than leaving stale
values behind (`$set` alone would never remove a key the new object
doesn't mention).

`ConnectionService.getDecryptedCredential(connectionId)` was added in
the Data Import phase — the only way any code outside this service can
obtain a usable credential for a connected source, keeping decryption
centralized here rather than duplicated wherever an authenticated
platform call is needed. It returns `null` for anything not currently
connected. `getDb()` (`src/infrastructure/mongodb/client.ts`) now also
calls `ensureIndexes()` on every cold start — previously indexes were
only created by tests, which left the real database without the
partial unique index Data Import's concurrency guard depends on.

## Facebook Page selection

After the Facebook Account OAuth callback succeeds, `GET
/api/connections/facebook/pages` decrypts the stored Account token
server-side, calls the Facebook connector's managed-Pages endpoint, and
returns only `{ id, name, category }` per Page — never a page access
token. `POST /api/connections/facebook/pages/select` re-fetches the
managed Pages server-side (using the stored Account token) and persists
only the Page the caller explicitly chose, together with its own
page-scoped access token, encrypted separately from the Account's
credential. No Page is ever auto-selected, even when the API returns
exactly one.

## API routes

All routes under `src/app/api/connections/`: validate input, call
`ConnectionService`, and return structured JSON errors
(`{ error: { code, message } }`) built by
`src/interfaces/http/errors.ts` — never a raw stack trace, never a
credential, never a MongoDB `_id` (every repository read projects
`{ _id: 0 }`). OAuth callback routes redirect back to `/` with a
`?connection=<platform>&result=<outcome>` flag rather than rendering JSON.

## Data Import domain objects

Three new public objects, three new collections, plus one small
persisted setting — all under `generic_schemas/`, Ajv-validated, draft
2020-12, `additionalProperties: false` at the top level.

**`importedContent`** (`importedContents`) — one record per unique
piece of content, identity = `platform` + `externalContentId`.
Repeated imports upsert this same record (`MongoImportedContentRepository.upsertByIdentity`
uses an atomic `findOneAndUpdate` with `$setOnInsert` for
`importedContentId`/`firstImportedAt`/`createdAt` and `$set` for
everything else, keyed by the collection's unique
`{platform, externalContentId}` index) — never a duplicate.
`platformData` holds the platform's own useful fields once; there is no
separate raw/normalized copy, and it never contains tokens, headers, or
other transport metadata.

**`performanceSnapshot`** (`performanceSnapshots`) — one record per
imported content item per UTC hour, identity = `importedContentId` +
`snapshotHour` (the collection time truncated to its UTC hour
boundary), upserted the same atomic way via the collection's unique
`{importedContentId, snapshotHour}` index. `metrics` is one flat object
mixing shared, cross-platform names (see below) and platform-specific
ones. A metric key that's absent was never returned by the platform; a
value of `null` means the platform explicitly reported it unavailable;
`0` is a real observed zero — these three states are preserved exactly
as the connector reported them, never collapsed. `dataCompleteness`
(`complete | partial | unavailable`) describes the snapshot as a whole.

**`importRun`** (`importRuns`) — one record per user-triggered import,
existing specifically to make an import debuggable after the fact: it
lists exact per-connection and per-item outcomes
(`success | partial | failed | skipped | unsupported`), not only
aggregate totals. Only one `importRun` may have `status: "running"` at
a time — enforced by a **partial unique index** on
`{ status: 1 }` filtered to `status: "running"`
(`src/infrastructure/mongodb/collections.ts`). `MongoImportRunRepository.createRunning`
does a plain `insertOne`; MongoDB itself rejects a second concurrent
"running" document with a duplicate-key error, which the repository
translates into `RunningImportConflictError` →
`DataImportService` converts it into a `409` via `SafeServiceError("importAlreadyRunning", …)`.
This is simpler and more robust than a separate lock collection or a
check-then-act query, and needs no queue or worker.

**`dataImportSettings`** (`dataImportSettings`) — not a general
settings framework, one persisted value: `recentContentLimit`
(default 30, range 1–100), always the single document keyed by the
fixed `settingKey: "dataImport"`.

## Content-type mapping

`src/application/mapping/contentTypeMapping.ts` — one explicit function
per platform (`mapInstagramContentType`, `mapFacebookContentType`,
`mapPinterestContentType`), no generic rules engine. Any combination
not recognized returns `"unknown"` rather than guessing.

## DataImportService and import orchestration

`src/application/services/DataImportService.ts` is the single service
covering settings, run history, imported-content reads, and
`runImport()`. It depends on `ConnectionService` (for the eligible
connections and their decrypted credentials) and the same three
connectors, all constructor-injected.

`runImport()`:

1. Reads the current `recentContentLimit` setting.
2. Atomically claims the "running" slot (or, if the existing running
   run started more than 15 minutes ago, treats it as stale — marks it
   `failed` with a `safeErrorMessage` explaining it was likely
   interrupted by a restart, and claims the slot instead — see "hosting
   runtime limit" below).
3. Filters `ConnectionService.list()` to `status: "connected"` and
   processes each connection with bounded concurrency
   (`mapWithConcurrency`, `src/application/util/concurrency.ts`, at
   most 3 connections and 5 items within a connection in flight at
   once — not a queue, just a concurrency cap on outbound requests
   within one synchronous request).
4. Per connection: fetches recent content, then per item upserts the
   `importedContent` record and fetches/upserts that item's
   `performanceSnapshot` for the current UTC hour. One item's failure
   (content save or metrics fetch) never stops the remaining items; one
   connection's failure never stops the other connections. A metrics
   fetch that fails or is unsupported still leaves the content metadata
   saved — only the snapshot reflects the shortfall
   (`dataCompleteness: "unavailable"`, or the item is marked `partial`
   with a safe reason).
5. Facebook Account is handled specially: its connection result is
   always `unsupported`, with no items attempted, since the Graph API
   genuinely cannot serve personal-profile content to standard apps —
   surfacing this honestly is required, not a bug to fix.
6. Aggregates `totals` and an overall `status`
   (`completed` only if every connection result was a clean `success`;
   `failed` only if there were no eligible connections or every one of
   them failed outright; `completedWithErrors` otherwise — including
   when the only blemish is Facebook Account's expected `unsupported`
   result, since that is still not a full clean success).

**Hosting runtime limit**: the whole import runs synchronously inside
the `POST /api/data-import/run` request handler — there is no queue or
background worker, per the explicit scope limit. If the hosting
platform enforces a request timeout shorter than a full import across
several connections and many items can take, the request may be cut
off mid-way, leaving a stale `status: "running"` record. Rather than
building queue/worker infrastructure to fully solve this, the 15-minute
staleness check above self-heals the next time an import is attempted,
which is judged sufficient for this MVP's expected data volume and
usage pattern.

## Data Import API routes

All routes under `src/app/api/data-import/` and
`src/app/api/imported-content/`: validate input, call
`DataImportService`, and return the same structured JSON error shape as
Account Connections. `GET /api/imported-content` and its
`[importedContentId]`/`[importedContentId]/performance` variants read
from MongoDB only — there is no code path where the UI could render a
live platform response instead of what was persisted.

## Deferred capabilities

Still out of scope: AI analysis, performance explanations,
recommendations, projects, content creation, content preparation,
content review, automatic knowledge generation, media upload,
publishing, scheduling, and social-post management.
