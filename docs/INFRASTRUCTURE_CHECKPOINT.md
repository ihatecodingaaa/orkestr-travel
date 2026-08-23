# Infrastructure checkpoint

Stage 3's local foundation is complete. What follows needs a database, and
creating one is a decision with a bill attached — so it is the founder's, not
an automated step.

---

## What is done, and what "done" means

| | Status |
|---|---|
| Domain, authority and privacy rules | **Implemented, fully tested** — no database needed |
| In-memory repository | **Implemented, fully tested** |
| PostgreSQL repository | **Implemented, NOT live-verified** |
| Migrations | **Written, never run** |
| Invite and session model | **Implemented, tested against the in-memory store** |
| Join flow and share screen | **Implemented, not exercised against a real database** |
| Local trips | **Working, unchanged, no configuration required** |

"NOT live-verified" is doing real work in that table. The Postgres adapter
compiles, implements the same contract, and has never spoken to a database.

## What the founder needs to do

**1. Pick a provider and create one PostgreSQL database.**

Recommendation below.

**2. Copy the connection string.**

**Do not paste it into chat.** Not to Claude, not into a commit message, not
into a doc.

**3. Put it in `.env.local` only:**

```
DATABASE_URL=…
APP_BASE_URL=http://localhost:3000
```

`.env.local` is already git-ignored, and `npm run check:secrets` fails the
build if an environment file is ever tracked.

**4. Confirm with exactly this, and nothing more:**

> DATABASE CONFIGURED

No value, no host, no username.

## Environment variables — names only

| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | for shared trips | Standard PostgreSQL connection string |
| `APP_BASE_URL` | for invite links | Absolute base for invite URLs. Falls back to the request origin in development |
| `ORKESTR_SHARED_MODE` | no | Set to `disabled` to switch shared trips off even where a database is reachable |

**No `NEXT_PUBLIC_` variants exist and none may be added.** A connection string
with a public prefix is a connection string in the browser bundle, permanently,
for everybody who ever loaded the page. A test asserts this.

## Recommendation

**Standard managed PostgreSQL, accessed through the standard driver.**

Ranked on portability, security, setup risk, connection handling and ease of
rollback — not on branding.

| Option | Verdict |
|---|---|
| **Managed Postgres + Next.js host** | **Recommended.** Persistence already depends only on a connection string. Any managed Postgres works, and moving is an environment variable rather than a rewrite |
| Managed Postgres + an Alibaba-compatible runtime | Equally fine. The application makes no assumption about the host |
| An integrated platform (auth + realtime + database) | Only if its auth is genuinely wanted. Stage 3 deliberately has no global account, so most of that value is unused today — and adopting its client SDK for persistence would undo the portability that was the point |

The thing worth protecting is that **no vendor SDK appears in persistence**.
That property is why this decision stays reversible, and it should survive
whichever provider is chosen.

## Diagnosing a connection that will not open

`npm run db:check` prints only shape facts and a SQLSTATE. It never prints the
URL, the host, the user or the password, so its output is safe to paste
anywhere.

| Code | Meaning | Usual fix |
|---|---|---|
| `28P01` | Password authentication failed | See below — most often an unescaped character |
| `28000` | The server refused this user | Check the username, or the provider's login rules |
| `3D000` | No such database | The database name at the end of the URL is wrong |
| `ETIMEDOUT` | The host did not answer | Firewall, or an IP allow-list that needs this machine |
| `ENOTFOUND` | Hostname does not resolve | A typo in the host |
| `0A000` / `XX000` | A connection option was rejected | Often a pooler URL missing a required option |

### `28P01` in particular

The password is usually right and the **URL** is usually wrong. In order of how
often it turns out to be the cause:

1. **A special character in the password is not percent-encoded.** `@ : / ? # &
   %` all mean something in a URL. A password containing `@` splits the URL in
   the wrong place and the server sees a different password. Encode it:
   `@` -> `%40`, `#` -> `%23`, `/` -> `%2F`, `:` -> `%3A`, `%` -> `%25`.
2. **The username needs a suffix.** Several providers require a project-scoped
   username for pooled connections (something like `postgres.abcdefgh`) while
   the direct connection uses plain `postgres`.
3. **A pooled URL with a direct password, or the reverse.** Some providers issue
   two connection strings; they are not interchangeable.
4. **The password was rotated** and the copied string is the old one.

Nothing about this needs Claude to see the value. Fix the URL in `.env.local`
and run `npm run db:check` again.

## After "DATABASE CONFIGURED"

1. Verify the variable exists and the connection succeeds — **redacted output
   only**, never the value.
2. `npm run db:migrate`.
3. Live integration tests against the real database.
4. Two-browser QA: organiser and traveller, invite, join, private data, conflict.
5. A privacy audit with a sentinel value against real HTML and RSC payloads.

**Deployment is a separate authorisation.** None of the above deploys anything.

## Database certificate — VERIFIED CLOSED (24 August 2026)

**Status: production TLS is verified against a real certificate.**

`PGSSLROOTCERT` points at the provider's root certificate, stored outside the
repository. With it:

```
npm run db:check
  TLS       : verified against PGSSLROOTCERT
  connected : yes
  server    : PostgreSQL 17.6
```

`PGSSL_ALLOW_UNVERIFIED` is **not set anywhere** and is no longer needed. The
database suite now runs the production trust path, and `next start` — which
forces verification and previously could not connect at all — serves the whole
shared product.

### What was proven, by connection attempt rather than by reading code

| Claim | Evidence |
|---|---|
| Certificate validation is enforced | An unrelated CA is rejected (`SELF_SIGNED_CERT_IN_CHAIN`) |
| Hostname verification is enforced | Node's identity check is invoked, receives the real host, and a failing verdict aborts the connection |
| Production needs no relax flag | Connects with `NODE_ENV=production` and the flag unset |
| The whole product works on it | 50/50 acceptance checks in production mode, `secure=true` cookie |

One earlier "hostname not checked" result was a **flawed test, not a flawed
configuration**: passing a wrong `servername` proves nothing because `pg` sets
`servername` itself from the connection host and discards the override.

### If the certificate ever has to be replaced

**One of these two.** Both are the founder's to obtain; nothing was downloaded
or invented.

**Option A — a publicly trusted certificate.** Some providers offer an endpoint
whose certificate chains to a public root Node already trusts. If yours does,
use that host and nothing else is required: `npm run db:check` will report
"verified against system roots".

**Option B — the provider's root certificate.** Download it from the provider's
own console or documentation, save it outside the repository, and set:

```
PGSSLROOTCERT=/absolute/path/to/provider-root.crt
```

`npm run db:check` should then report "verified against `PGSSLROOTCERT`".

**Where to find it, by provider** — check the provider's own docs; the usual
locations are:

| Provider | Where the root certificate lives |
|---|---|
| Supabase | Project Settings → Database → Connection info → "Download certificate" |
| Neon | Uses publicly trusted certificates; Option A applies |
| RDS / Aurora | AWS "rds-ca-rsa2048-g1" bundle, from the RDS SSL documentation |
| Alibaba Cloud RDS | Console → Instance → Data Security → SSL → Download CA |

**Do not paste the certificate into chat.** It is not secret, but it does not
belong in the transcript, and it must not be committed — a test asserts no
certificate is embedded in source.

Until this is done, deployment is blocked: production will refuse to connect
rather than connect unverified, which is the intended failure.

## Model Studio — separate, and outstanding

A Model Studio credential was surfaced in `.env.local` by the IDE during an
earlier session. It has never been read, printed, or committed, and it is
git-ignored.

**Before any production use it must be rotated by the founder:**

1. Create a new API key in the same Singapore region and workspace.
2. Put it in `.env.local` under the existing server-only variable name.
3. Smoke-test it only when explicitly authorised.
4. Revoke the old key **after** the new one is confirmed working.
5. Never paste either key into chat.

**Shared trips do not need Model Studio.** Creating, joining and editing a trip
works with it unavailable, so testing invites costs nothing in AI charges.

**Atlas is also separate.** Its CLI holds credentials in OS-secure storage and
authorises through a browser. Nothing about shared trips requires it on a
server, and no Atlas credential material should ever be exported to hosting.
