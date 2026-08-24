# Production deployment

Vercel + Supabase PostgreSQL + Alibaba Cloud Model Studio.

---

## Why this shape

| Piece | Choice | Why |
|---|---|---|
| Runtime | **Vercel** | The application is already Next.js with server components and server actions. Nothing has to change |
| Database | **Supabase PostgreSQL** | Persistence depends only on a connection string and the standard `pg` driver. No provider SDK touches it, so this is reversible |
| AI | **Alibaba Cloud Model Studio** | Already the production AI boundary, Singapore region, server-only |
| Flights | **Recorded Atlas Sandbox** | The Atlas CLI needs browser authorisation and OS-secure credential storage. Neither exists on a serverless platform, and its credentials are not exportable |

The application does **not** move cloud for branding. Reliability beats
hosting-brand theatre, and the property worth protecting — no vendor SDK in
persistence — survives whichever provider is chosen.

## The runtime connection: transaction pooling

**Orkestr is transaction-pooler compatible, and that was audited rather than
assumed.** Every statement is either a single parameterised query or a
`BEGIN … COMMIT` block opened and closed inside one function call.

| Feature that breaks transaction pooling | Present? |
|---|---|
| Named prepared statements | **No** — all queries are text + params, so `pg` uses unnamed extended-protocol statements |
| `SET SESSION` / `SET LOCAL` | No |
| Advisory locks spanning transactions | No |
| `LISTEN` / `NOTIFY` | No |
| Temporary tables | No |
| Cursors (`DECLARE … CURSOR`) | No |
| `PREPARE` / `DEALLOCATE` | No |
| Session affinity of any kind | No |

`SELECT … FOR UPDATE` **is** used, in `writePayload`. It is transaction-scoped,
which is exactly what a transaction pooler supports.

**So `DATABASE_URL` in production should be a transaction-mode pooled URL**
(Supabase Shared Pooler, port `6543`). That is what serverless wants: many
short-lived instances, each holding a connection for one query.

If any of the rows above ever becomes "yes", this decision has to be revisited
before it silently breaks under load.

## The migration connection

Migrations are **not** request traffic. They run once, from a terminal, doing
DDL in a long session.

`MIGRATION_DATABASE_URL` exists for that: set it to the direct/session
connection your provider offers and leave `DATABASE_URL` as the pooled runtime
one. With it unset, the migration tools fall back to `DATABASE_URL`, which is
correct for a local database where there is only one.

**Nothing migrates automatically.** Not on build, not on deploy, not on first
request. `npm run db:migrate` is a thing a person types.

## Connection pool

| Setting | Production | Why |
|---|---|---|
| `max` | **2** | Each serverless instance gets its own pool. A generous max × however many instances a spike creates is how a database hits its connection limit and refuses everybody |
| `idleTimeoutMillis` | 10s | A warm instance can sit unused for minutes; holding a connection through that holds a slot somebody needs |
| `connectionTimeoutMillis` | 8s | A function that waits forever burns its whole budget and fails anyway |
| `statement_timeout` | 10s | Enforced by the **server**, so it still works when the client has gone away |
| `idle_in_transaction_session_timeout` | 15s | A pooled connection abandoned mid-transaction would otherwise hold a row lock |

**No retries.** These writes are not idempotent, and a retry that succeeds after
a timeout the caller gave up on is how one invitation becomes two joins.
Optimistic versioning makes a race safe to *refuse*, not safe to replay.

## TLS

Production always verifies. Precedence:

1. **`PGSSLROOTCERT_B64`** — certificate material from the environment. This is
   the serverless path: there is no filesystem to put a certificate in, so it
   travels as a variable. Base64 because several deployment UIs mangle
   multi-line values; raw PEM is accepted too.
2. **`PGSSLROOTCERT`** — a file path. The local development path.
3. **`PGSSL_ALLOW_UNVERIFIED=true`** — development only, **ignored in production**.
4. **System roots** — the fail-closed default: still verifies, and simply fails
   against an untrusted server.

Environment beats file so a deployment cannot be silently altered by a path that
happens to exist in an image. Malformed material **fails loudly** rather than
falling through to a weaker root, and no error message ever echoes it.

## The canonical origin

An invite link is a bearer credential, so where it points matters as much as who
holds it.

**In production the origin comes only from `APP_BASE_URL`, never from the
request.** `Host` is attacker-controlled: an organiser could be served a link
pointing at somebody else's host, press Copy, and hand the group's tokens away.
Production also requires `https`. Plain `http` is allowed only on loopback, in
development.

With `APP_BASE_URL` unset in production, invite creation **refuses** rather than
guessing — an organiser copying a link that points nowhere finds out when four
people cannot join.

That means a two-step first deployment:

1. Deploy. Vercel assigns a stable production HTTPS URL.
2. Set `APP_BASE_URL` to it, redeploy, then test invites.

## Preview deployments

**Preview sets `ORKESTR_SHARED_MODE=disabled`.**

Without it, every branch preview writes into the same shared trips real people
are using. Preview keeps the full local product — trips, explore, plan, what-if,
the example — and says plainly that sharing is not configured there.

A preview that genuinely needs shared mode gets its own database, not the
production one.

## The build needs nothing

Verified: `next build` succeeds with **no** `DATABASE_URL`, **no** Model Studio
key and **no** certificate. Every route that needs real data is server-rendered
on demand; everything static comes from fixtures compiled into the bundle.

A deployment therefore cannot fail because a provider was slow, and the first
deploy can happen before the environment is complete.

## Region

Put Vercel's function region in Singapore (`sin1`) to sit beside Supabase
Singapore and Model Studio Singapore. Three round trips per request across the
Pacific and back is latency nobody has to pay for.

## What is not deployed

**Atlas.** Its CLI authorises through a browser and stores credentials in the
OS keychain — neither exists on a serverless platform, and exporting them is
explicitly out of bounds. Where flight data appears it is labelled
**recorded Atlas Sandbox**, and it is never called live, purchasable or booked.

## A custom domain — recommended, not configured

**Nothing here has been done.** DNS is deliberately untouched; this is a
recommendation for after the public product is proven.

The `.vercel.app` URL is fine for a hackathon submission and costs nothing. A
custom domain is worth it for one reason and it is not branding: **invite links
carry the origin**. A link somebody forwards to their family reads
`orkestr.travel/join/…` rather than a hosting provider's subdomain, and it keeps
working if the hosting ever moves — the `.vercel.app` name does not.

If it is done, the order matters:

1. Add the domain in Vercel and let its certificate issue **before** anything
   points at it.
2. Set `APP_BASE_URL` to the new origin in Production, and redeploy. Invite links
   are built from that variable, not from the request, so a domain switch with a
   stale variable produces links pointing at the old origin — issued correctly,
   and wrong forever once sent.
3. Redeem one synthetic invite end to end on the new origin before announcing it.
4. Keep the `.vercel.app` origin working. Links already sent use it.

Invitations already in the wild are the reason this is a considered change and
not a cosmetic one: a token is a URL, and changing the origin changes every URL
that has not yet been opened.
