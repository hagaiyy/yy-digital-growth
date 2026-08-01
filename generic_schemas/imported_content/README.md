# importedContent

One persisted record per unique piece of content imported from a
connected platform source. MongoDB collection: `importedContents`.

- Unique identity: `platform` + `externalContentId`. Repeated imports
  upsert this same record rather than creating duplicates.
- `platformData` holds the platform's own useful fields once — there is
  no separate raw/normalized copy. It never contains access tokens,
  request headers, authorization data, or transport metadata.
- `firstImportedAt` is set once and never changed; `lastImportedAt`
  advances on every subsequent import that touches this record.

See `docs/system-contract.md` for the content-type mapping rules and
platform-specific import behavior.
