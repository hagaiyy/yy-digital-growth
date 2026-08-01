# platformConnection

Represents the connection state of one account or Page on one social
platform. This is the only public domain object in the current phase.

- MongoDB collection: `platformConnections`
- Never contains credentials (tokens, secrets, authorization codes). See
  the separate, private credential storage described in
  `docs/system-contract.md`.
- `connectionTarget: "page"` records use `parentConnectionId` to reference
  the `connectionTarget: "account"` record they were discovered through
  (used only for the Facebook Page → Facebook Account relationship).

See `docs/system-contract.md` for the full field-by-field contract and
`docs/current-scope.md` for what this phase does and does not implement.
