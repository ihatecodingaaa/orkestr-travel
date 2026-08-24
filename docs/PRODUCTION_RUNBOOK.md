# Production runbook

What to do when something needs doing. Written for the person on call, which
for now is the founder.

---

## Deploying a change

1. `npm run verify` and `npm run test:db` locally. Both green.
2. Push to `main`. Vercel builds and deploys.
3. Watch the deployment. If the build fails, **fix the code** — do not disable a
   gate to get past it.

**Environment variable changes need a new deployment.** Vercel bakes them in at
build time; editing a value and waiting changes nothing.

## Rolling back

**Application:** Vercel → Deployments → the last known-good one → *Promote to
Production*. Nothing is deleted, so this is reversible in both directions.

**Code:** `git revert <sha>` and push. Never force-push `main`.

**Schema:** there are no down-migrations, deliberately — a down-migration is a
script nobody tests that runs when things are already going wrong. The schema is
additive, so the previous application version does not see the new columns and
does not care they exist. If something genuinely has to go, write a forward
migration that drops it, review it, and run it once nothing reads it.

## Running a migration

```bash
npm run db:status     # what has run, what has not
npm run db:migrate    # apply what is pending
```

Uses `MIGRATION_DATABASE_URL` if set, otherwise `DATABASE_URL`. Never runs
automatically. Never prints the connection string.

## The database is unreachable

Symptoms: shared trips fail; local trips keep working.

```bash
npm run db:check
```

Prints the SQLSTATE and a plain-English cause, and never the URL. Common ones:

| Code | Meaning |
|---|---|
| `28P01` | Wrong password — usually an unescaped character in the URL |
| `SELF_SIGNED_CERT_IN_CHAIN` | The trust root is missing or wrong |
| `53300` | Too many connections — check `max` and how many instances are running |
| `ETIMEDOUT` | Firewall or IP allow-list |

**If it cannot be fixed quickly:** set `ORKESTR_SHARED_MODE=disabled` in
Production and redeploy. Shared controls then say sharing is unavailable instead
of failing, and the local product keeps working. This is a real off switch, not
a degraded-truth mode: it never shows a stale local copy as if it were current.

## Somebody's invite link leaked

An invite is a bearer token. Whoever opens it first joins as that member.

1. Organiser → trip → **Invite people** → **Revoke** on that person's row.
2. **New link** for them, sent directly.

The share screen shows who has actually joined, so an unexpected "Joined" is the
signal something went wrong.

## Somebody lost access

They cleared cookies, changed device, or changed browser. There is no account
and no recovery — this is the documented cost of not putting a signup wall in
front of a holiday.

The organiser issues a new invite. That is the whole fix.

## A private value has leaked

Treat as an incident.

1. Confirm it: fetch the page as a non-owner and search the raw HTML **and** the
   RSC payload. `docs/PRODUCTION_ACCEPTANCE.md` has the exact method.
2. If confirmed, set `ORKESTR_SHARED_MODE=disabled` and redeploy — stop the
   bleeding before diagnosing.
3. Find which builder returned it. Privacy is structural: owner-only values live
   in `member_private_data` and reach a reader only through `buildActorTrip`. A
   leak means something bypassed that, not that a filter was misconfigured.
4. Add the failing case to `tests/sharedTrips.test.ts` before fixing it.

## Rotating the Model Studio key

1. Create a new key in the **same Singapore region and workspace**.
2. Update `DASHSCOPE_API_KEY` in Vercel → Production. Redeploy.
3. `npm run smoke:model-studio` locally against the new key.
4. Revoke the old key **after** the new one is confirmed working.

Never paste either key into a chat, a commit, or a document.

## Rotating the database certificate

Providers rotate roots on a schedule and it is not always announced loudly.

1. Download the new root from the provider's console.
2. Base64 it, update `PGSSLROOTCERT_B64` in Production, redeploy.
3. `npm run db:check` locally with the new material to confirm it verifies.

**Do not** work around an expiring certificate with
`PGSSL_ALLOW_UNVERIFIED` — it is ignored in production, by design.

## Cleaning up test data

Synthetic trips use recognisable id prefixes (`e2e-`, `qa-`, `itest-`,
`mtest-`, and `prod-` for production acceptance). Delete by prefix through
`shared_trip`; `ON DELETE CASCADE` removes members, invitations, private data
and events.

```bash
npm run db:cleanup             # dry run: says what it would delete
npm run db:cleanup -- --commit # actually delete
```

`browser_session` is deliberately **not** cascaded, because a browser outlives
any one trip. Deleting a trip therefore strands the sessions whose only
membership it was, so the script also removes sessions that have no memberships
left. Having no memberships is the test, not age — a real session that still has
access is never eligible.

**Never delete `schema_migration` rows.** Removing one makes the next deploy try
to reapply a migration that has already run. The cleanup script contains no code
path that names that table. Never hand-edit rows in a provider dashboard unless
recovering from something.

## What free tiers actually mean

Stated here rather than in the product, where it would be noise:

* **Supabase Free** may pause a project after a period of inactivity, and has
  connection and storage limits. A paused project looks exactly like an outage.
* **Vercel Hobby** has execution and bandwidth limits, and is not licensed for
  commercial use.
* **Model Studio is usage-billed.** There is no free ceiling protecting you; the
  kill switch (`MODEL_STUDIO_MODE=disabled`) is the protection.

None of these are reasons not to launch. All of them are reasons not to promise
availability.
