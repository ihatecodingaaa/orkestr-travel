# Migrations

Plain SQL, applied in filename order, tracked in Git.

```
0001_shared_trips.sql
```

## Why plain SQL

No migration framework, no ORM. The schema is small, standard PostgreSQL, and
the thing most worth being able to read in five years is exactly what ran
against the database. A framework would add a dependency, a lock file entry and
a DSL, and would still produce this SQL.

## Rules

**Never applied automatically.** Nothing runs a migration on page load, on boot,
or on a deploy hook. `npm run db:migrate` is a thing a person types, having
decided to. A schema change that happens because somebody opened a web page is
a schema change nobody reviewed.

**Forward-only, and additive by default.** A `DROP COLUMN` in a release that
gets rolled back takes the data with it. Add the new shape, move to it, remove
the old one in a later migration once nothing reads it.

**Every file is idempotent where it can be** (`IF NOT EXISTS`), so a partial run
can be repeated safely.

**Secrets never appear here.** These files are in Git. The connection string is
not.

## Applying them

```bash
npm run db:migrate          # apply anything not yet recorded
npm run db:status           # what has run, what has not
```

Both read `DATABASE_URL` from the environment and neither ever prints it.

## Rollback

There are no down-migrations, deliberately: a down-migration is a script nobody
tests that runs when things are already going wrong.

To roll back:

1. Deploy the previous application version. The schema is additive, so the old
   code does not see the new columns and does not care that they exist.
2. If a table genuinely has to go, write a new forward migration that drops it,
   review it like any other change, and run it once nothing references it.

`shared_trip.version` is application-level optimistic concurrency, not a schema
version. The two are unrelated and neither implies the other.
