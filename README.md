# YY Digital Growth

## Purpose

YY Digital Growth will eventually connect to social-platform accounts,
import recently published content, pull marketing and engagement
metrics, store performance history, compare content, and generate
improvement recommendations.

## Current phase

**Account Connections** and **Data Import** — the first two
implementation phases of the MVP.

Account Connections implements connecting, verifying, reconnecting, and
disconnecting social-platform accounts, with persisted connection
state. Data Import implements importing recent published content and
its available performance data from every connected source, persisting
it in MongoDB, and displaying only that persisted state. Analysis,
recommendations, publishing, scheduling, and media upload are not part
of either phase.

## Main Dashboard

The application has one page, **Main Dashboard**, at `/`. It has two
tabs:

1. **Account Connections** (selected by default) — Instagram, Facebook
   Account, Facebook Page, and Pinterest connection state, each with its
   status, connected account details (when available), and the
   available action (Connect / Verify / Reconnect / Disconnect).
2. **Data Import** — disabled until at least one connection has status
   `connected`. When enabled, it shows the eligible connected sources,
   the Recent Content Limit setting, an Import Data button, import
   progress, the last import's summary (including exact failed,
   skipped, and unsupported items — not just totals), and the imported
   content currently persisted in MongoDB.

See [docs/current-scope.md](docs/current-scope.md) for the full scope
boundary and [docs/system-contract.md](docs/system-contract.md) for how
connection persistence, data import, and credential security work.

## Technology stack

- TypeScript
- Next.js (App Router), Node.js runtime
- MongoDB Atlas, accessed via the **native MongoDB Node.js driver** (no
  Prisma, no Mongoose)
- JSON Schema as the canonical data contract, validated at runtime with
  Ajv (draft 2020-12)
- No authentication framework, no design system, no social-publishing
  SDK

## Local setup

Requirements: Node.js 20+, a MongoDB Atlas (or local) database.

```bash
npm install
cp .env.example .env.local   # then fill in the values you have
npm run dev
```

Visit `https://localhost:3000/` for the Main Dashboard.

### Local development runs over HTTPS

`npm run dev` starts `next dev` with `--experimental-https`, serving
`https://localhost:3000` (not `http://`). This is required because
Instagram's OAuth callback (`https://localhost:3000/api/connections/instagram/callback`)
must be reachable over HTTPS.

The dev server reads its certificate/key from `certificates/localhost.pem`
and `certificates/localhost-key.pem` — generate them once with:

```bash
mkdir -p certificates
openssl req -x509 -newkey rsa:2048 -keyout certificates/localhost-key.pem \
  -out certificates/localhost.pem -days 825 -nodes -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"
```

This certificate is **local-only** (self-signed, no CA, no public
tunnel) and the `certificates/` directory is gitignored — never commit
it. Since it isn't signed by a trusted CA, browsers show a warning the
first time; either click through it, or trust it once for your own
machine so future visits load with no warning:

```bash
security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db \
  certificates/localhost.pem
```

(macOS/Chrome shown above — on Linux, add it to your browser's/OS's own
certificate store instead. `curl -k` also works for non-browser checks
without touching any trust store.)

### Environment variables

| Variable | Required for |
| --- | --- |
| `MONGODB_URI`, `MONGODB_DATABASE` | Everything — connection state and credentials are both stored in MongoDB. |
| `APP_ENCRYPTION_KEY` | Storing or reading any private credential. Without it, every connection action returns `setupRequired` rather than storing anything in plaintext. |
| `APP_BASE_URL` | Building OAuth redirect targets back to the Main Dashboard. Falls back to the request's own origin if unset. |
| `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI` | The Facebook OAuth connection flow (Facebook Account + Facebook Page). |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI` | The Instagram OAuth connection flow, using **Instagram API with Instagram Login** — a separate Instagram App ID/Secret from your Meta app's Instagram product settings, never the Facebook App ID/Secret. There is no environment-supplied Instagram access token or account ID — both come from completing the interactive authorization flow. |
| `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET`, `PINTEREST_REDIRECT_URI` | The Pinterest OAuth connection flow. |

Any platform whose variables are missing shows status `setupRequired` in
Account Connections instead of a fake or broken connection attempt.
Data Import introduces no new environment variables — it reuses each
connection's already-stored, already-encrypted credential.

> **Scope change for Data Import:** the Facebook OAuth scope gained
> `pages_read_engagement`, and the Pinterest OAuth scope gained
> `pins:read`, so that Page posts and Pinterest Pins can be read.
> `read_insights` was also requested for a time so Page post metrics
> could be read, but Meta rejects it for this app with "Invalid
> Scopes"; it has been removed. Facebook's current scope is exactly
> `public_profile,pages_show_list,pages_read_engagement`, and Page post
> metrics report as unsupported rather than depending on it. A Facebook
> or Pinterest account connected before this phase must be reconnected
> (Disconnect, then Connect again) to pick up the wider scope —
> Instagram and existing connection records are unaffected.

> **Instagram now uses Instagram API with Instagram Login**, not
> Facebook Login for Business. It authorizes directly against Instagram
> (`www.instagram.com/oauth/authorize`) using `INSTAGRAM_APP_ID` /
> `INSTAGRAM_APP_SECRET` — separate credentials from `META_APP_ID` /
> `META_APP_SECRET`, taken from your Meta app's own Instagram App
> ID/Secret fields — and requests only `instagram_business_basic` and
> `instagram_business_manage_insights` (never `instagram_basic`,
> `instagram_manage_insights`, `pages_show_list`, or
> `pages_read_engagement`, which this scope pairing does not support and
> which Meta rejects with "Invalid Scopes"). Any Instagram account
> connected under the old flow must be reconnected. The Facebook
> connection is unaffected.

Other scripts:

```bash
npm run lint
npm run typecheck
npm test               # unit tests with fakes; MongoDB integration tests
                        # only run when MONGODB_TEST_URI is set
npm run build
```

## Documentation

- [docs/system-contract.md](docs/system-contract.md) — the
  `platformConnection` data contract, credential security, and
  persistence rules.
- [docs/current-scope.md](docs/current-scope.md) — exactly what this
  phase implements and defers.
