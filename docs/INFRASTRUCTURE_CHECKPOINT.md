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

## After "DATABASE CONFIGURED"

1. Verify the variable exists and the connection succeeds — **redacted output
   only**, never the value.
2. `npm run db:migrate`.
3. Live integration tests against the real database.
4. Two-browser QA: organiser and traveller, invite, join, private data, conflict.
5. A privacy audit with a sentinel value against real HTML and RSC payloads.

**Deployment is a separate authorisation.** None of the above deploys anything.

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
