# The shared data model

Seven tables. Standard PostgreSQL, no provider extension, no vendor type.

---

## Shape

```
shared_trip ──┬── trip_member ──┬── member_private_data   (owner-only)
              │                 ├── trip_invitation       (token hash only)
              │                 └── session_membership ── browser_session
              └── trip_event
```

| Table | Holds | Notes |
|---|---|---|
| `shared_trip` | The group-visible `ConsumerTrip` as JSONB, plus `version` | The payload contains **no** owner-only values |
| `trip_member` | A person on the trip | `traveller_id` links to the id inside the payload |
| `member_private_data` | Owner-only requirements | Read only by its owner |
| `trip_invitation` | `token_hash`, expiry, redemption, revocation | Never a raw token |
| `browser_session` | `token_hash`, expiry, revocation | A browser, not a person |
| `session_membership` | Which member a session speaks as, per trip | One session, several trips |
| `trip_event` | What happened, in traveller words | **Never** a private value |

## Why the payload is JSONB

The planning model — travellers, ideas, plan items, budget, autopilot — is
already a single validated JSON document that the local product reads and
writes. Shredding it into twenty relational tables would mean two models of the
same thing, kept in step by hand, and the shared screens would stop being the
same screens as the local ones.

So the trip stays one document, and the things that are genuinely *not* one
document get their own tables: membership, privacy, invitations, sessions,
events. Those are exactly the concepts that only exist once a trip has more than
one reader.

## Why privacy is a separate table

Privacy that depends on remembering to filter a field fails the first time
somebody adds a field.

`member_private_data` means the group query **cannot** return a private value:
there is nothing to strip, because there was never anything there. The count
query does not even select the `requirements` column, so it physically cannot
return one regardless of what a caller does with the result.

A future query written by somebody who has never read these docs still cannot
leak a budget.

## The version column

`shared_trip.version` is application-level optimistic concurrency, bumped on
every accepted write. It is **not** a schema version and implies nothing about
migrations.

Writes carry the version they were made against, and it goes in the `WHERE`
clause:

```sql
UPDATE shared_trip
   SET payload = $2, version = version + 1, updated_at = $3
 WHERE id = $1 AND version = $4
```

One row or none, atomically. Two writers racing produce one winner and one
conflict — never one silent loss.

## Portability

Nothing here mentions a hosting provider. Persistence depends on a connection
string and the standard `pg` driver; a managed Postgres from any provider runs
`migrations/0001_shared_trips.sql` unchanged.

That is deliberate, and it is what keeps the hosting decision reversible. The
moment persistence imports a vendor client, moving costs a rewrite instead of an
environment variable.

## Two implementations, one contract

`SharedTripRepository` is implemented twice: in memory for the tests, in
PostgreSQL for a deployment.

The in-memory one is **not a mock**. It enforces the version check, performs
redemption in one step, and keeps private data in a separate map with no route
from the trip payload. That is what lets the tests that matter — who may read
what, what happens to a stale write — run on every commit in milliseconds
without a database.

If the two ever disagree, those tests stop meaning anything.
