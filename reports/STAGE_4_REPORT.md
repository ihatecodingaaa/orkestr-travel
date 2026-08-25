# Stage 4 Report

**Production readiness and public deployment: Vercel, Supabase PostgreSQL,
verified TLS from a serverless runtime, public acceptance against the deployed
product, and one live Model Studio investigation.**

Date: 25 August 2026
Repository: `C:\Users\lucas\Documents\orkestr-travel`
Remote: `https://github.com/ihatecodingaaa/orkestr-travel.git`
Production: `https://orkestr-travel.vercel.app`

---

## 1. Executive status

**Orkestr is deployed, publicly reachable, and shared trips work on it.**

A person can open the URL from another country, be given a trip by an invite
link, answer their own questions, add ideas, see somebody else's change arrive
without reloading, and be refused the things they are not allowed to do — all
against a real PostgreSQL database over verified TLS, from Vercel's Singapore
region.

Two things are **not** true and are recorded as such throughout:

1. ~~**Model Studio does not work from production.** It is not slow; nothing
   answers. This is an infrastructure question for the founder, not a code
   change.~~ **CORRECTED 25 August 2026:** this was wrong. The network,
   credential and inference all work from production. The 30 s extraction
   ceiling was below a 30.4–32.8 s job; raising it to 50 s fixed it. What still
   blocks `/understand` is a separate defect — the model invents supporting
   quotes and the traceability guard refuses them. Section 12, and
   `reports/INCIDENT_MODEL_STUDIO_CONNECTIVITY.md`.
2. **There is no custom domain.** DNS is deliberately untouched. Section 15.

Public acceptance also found a **real defect that every unit test missed and
that had shipped** — shared writes were made against the polled trip version
rather than the version the reader was looking at, which made the optimistic
concurrency refusal unreachable. Section 10.

Gates: **1,343 tests across 61 files**, plus 4 browser-bundle tests after the
build and 32 live database tests. Lint, typecheck and the production build
clean. Baseline entering Stage 4 was 1,341.

---

## 2. What is deployed

| Piece | Choice | Why |
| --- | --- | --- |
| Hosting | Vercel, region `sin1` | Beside Supabase Singapore and Model Studio Singapore |
| Database | Supabase PostgreSQL, transaction pooler | Serverless functions cannot hold connections |
| Driver | `pg` | No vendor SDK in persistence, so the database stays portable |
| Runtime secrets | Vercel Production scope only | Preview never receives production credentials |

The application talks to PostgreSQL through the standard driver and plain SQL.
Nothing in the persistence layer names a hosting provider, so moving off
Supabase is a connection-string change rather than a rewrite. That property was
worth keeping and it survived deployment.

---

## 3. Environment variable scoping

All real runtime variables are scoped to **Production only**. Preview
deployments receive no production database credential and no Model Studio
credential.

This took three rounds to get right and the failure is worth recording, because
the wrong diagnosis was plausible each time. `ORKESTR_SHARED_MODE` kept
appearing in Production after being removed. Caching was ruled out, then a stale
build environment snapshot was ruled out by pushing a fresh commit, then the
repository itself was ruled out — which left a **team-level shared variable**
being injected into every project. Nothing in the repository could have shown
that, and no amount of reading the code would have found it.

**No environment variable value was printed or inspected at any point in Stage
4.** Diagnosis used shape facts and SQLSTATE codes only.

---

## 4. TLS to the database, from serverless

Production verifies the database certificate against a real provider CA, with
`PGSSL_ALLOW_UNVERIFIED` unset. Certificate material is delivered as
`PGSSLROOTCERT_B64`, because a serverless filesystem has nowhere to put a `.pem`
file that survives.

Precedence is `PGSSLROOTCERT_B64` → `PGSSLROOTCERT` → a development-only relax
path → system roots. `parseCertMaterial` validates the material and never echoes
it, so a malformed certificate produces a diagnosis rather than a leak.

**Both halves were proven with negative controls**, because a passing TLS test
proves very little on its own:

* CA verification: a deliberately wrong CA must fail. It did.
* Hostname verification: proven by testing the `checkServerIdentity` hook
  directly.

The hostname test had to be redone. My first version passed a wrong `servername`
and observed a failure — which proved nothing, because **`pg` sets `servername`
itself** from the connection host, so the value under test was never used. That
was my error in test construction, not a configuration flaw, and the corrected
test targets the hook.

---

## 5. Connection pool and query safety

`max: 2` in production, `statement_timeout: 10s`, `idle_in_transaction_session_timeout: 15s`,
and **no retries**. A serverless platform multiplies concurrency by instance
count, so a large pool per instance is how a database runs out of connections
during a demo. Retries are absent deliberately: a retry on a write that may have
already committed is how one action becomes two.

The transaction-pooler audit holds: no named prepared statements, no session
state, no `LISTEN`/`NOTIFY`, no advisory locks, no temporary tables, and
`FOR UPDATE` only inside a transaction.

---

## 6. Security headers and the browser bundle

Security headers are set in `next.config.ts`, and `poweredByHeader` is off. A
full Content-Security-Policy is **deliberately absent**, and the reason is
written down rather than left as an omission: Next's inline bootstrap requires
either `unsafe-inline` or per-request nonces, and a CSP containing
`unsafe-inline` is a policy that looks like protection while providing very
little. It is recorded as not-done rather than claimed.

The browser bundle audit passes with a positive control: **753,629 bytes across
14 assets**, and no server-only module reachable from client code. The positive
control matters — the test was previously capable of passing without inspecting
anything, and now fails when it should.

---

## 7. Session cookies over real HTTPS

Verified on the deployed product, not inferred from configuration:
`HttpOnly=true`, `Secure=true`, `SameSite=Lax`.

The cookie is an **opaque lookup key**. It carries no claims — no trip id, no
member id, no role. Who a request is from is resolved server-side from the
session, so there is no field a client could edit to become somebody else.

---

## 8. Privacy, verified against what production actually sent

Private values were checked for absence in **both** the HTML and the RSC
payload, for an organiser and for a traveller.

The first version of this check was **vacuous and passed anyway**. The RSC
request returned a 307 to `?_rsc` and the empty redirect body contained no
private data — because it contained nothing at all. The corrected check follows
redirects and asserts the payload is genuinely present (it must contain
"Seoul") *before* asserting that private values are absent from it. A privacy
test that cannot fail is worse than no privacy test, because it is trusted.

---

## 9. Authority, on the deployed product

Shared acceptance ran **53 of 54 checks green**. The one non-green was a
mis-framed assertion of mine, not a product failure: I asserted the wrong
expected text for a traveller attempting to edit the plan. The server does
refuse it, and says:

> "Only the organiser can change the plan. Save it as an idea and they'll see it."

Refusals are sentences a person can act on, and they are produced server-side.
The client never decides what is allowed.

---

## 10. The defect public acceptance found

This is the most important section in this report.

**`SharedScreen` and `MyDetails` wrote against the polled version, not the
version the reader was actually looking at.**

`useTripSync` polls for an integer and raises its own version the instant the
server moves, then calls `router.refresh()` — which is a network round trip. In
the window between those two events, the screen shows the **old trip carrying
the new version number**. A write submitted in that window satisfies

```sql
UPDATE shared_trip SET ... WHERE id = $1 AND version = $4
```

and is applied against a trip the person has never seen. Silently. That is
precisely the failure the concurrency module was written to prevent, described
in its own doc comment:

> Mum opens the trip, Zen changes their dates, Mum saves a note she started
> writing before that happened, and Zen's change is gone. Nobody sees an error.

**The conflict path was not merely untested — it was unreachable.** Two live
browsers racing on the deployed site could not produce a refusal, because the
poll kept handing the loser a winning version. Every unit test passed the whole
time, because each half was correct in isolation; only the join between them was
wrong.

It was found by production acceptance failing in a way I could not explain, and
then by reading the wiring rather than trusting my first two theories about it.
Both of those theories were wrong, and both were comfortable.

**The fix.** Writes now state the server-rendered `version` prop — the version
the rendered trip came from, which is the only version the reader can be said to
have seen. `useTripSync` no longer returns a version at all, so the mistake is
now a **type error rather than a convention**. Its polled number is an input to
"should I refetch", never to "what may I write against".

Also folded the duplicated `CONFLICT_MESSAGE` in `applyMutation` onto the one in
`core/shared/concurrency`, which until then had no caller at all. Two copies of
the same sentence is how the two halves drift.

**Two guards were added, and both fail on the previous code** — no vacuous
tests. Verified live on the deployed product afterwards: the losing browser is
told

> "The trip changed while you were editing. Orkestr has refreshed it — please
> check your change still makes sense."

and its write is **not persisted**.

---

## 11. Cross-origin writes

My first CSRF check reported a failure that was not one. I POSTed to a *page*
route with `Content-Type: text/plain` and no `Next-Action` header, and read the
`200` as "the mutation was accepted". It was not — Next renders the page for an
unrecognised POST. **A status code was the wrong thing to measure.**

The corrected test captures a **real server-action request** — its headers,
including `Next-Action`, and its body — from a genuine click, then replays it
with `Origin: https://attacker.example` and cookies attached, and compares the
trip before and after.

Result: the replay returns 200 and **mutates nothing**. The plan is byte-identical
across the replay. Confirmed again after the concurrency fix, on the new build.

---

## 12. Model Studio from production: NOT WORKING

> **CORRECTED 25 August 2026 — this section's conclusion was wrong.**
>
> It was not a connectivity problem. The network path from Vercel to Model
> Studio Singapore was healthy the whole time: DNS, TCP, TLS, an authenticated
> listing request (HTTP 200 in 37 ms) and a real `qwen3.7-plus` completion
> (1,300 ms) all succeed from the deployed runtime.
>
> The actual cause was that the 30,000 ms extraction ceiling was below a job
> that takes 30,384–32,809 ms. A non-streaming completion sends no headers until
> it has a response, so the abort produced *"the provider did not answer at
> all"* — which reads like a network fault. I inferred the layer from a single
> absent number instead of testing it.
>
> Fixed by raising the ceiling to 50,000 ms with `maxDuration = 60` on the page.
> Full account: `reports/INCIDENT_MODEL_STUDIO_CONNECTIVITY.md`.
>
> The original text is kept below unaltered, because a report that quietly
> edits its own wrong conclusion is worth less than one that shows it.



Recorded as **not working**, not as slow, because the distinction changes what
the fix is.

The founder observed a production run reporting a 30-second timeout while the
same thing completed locally. Seven questions were asked. The answers:

1. **Which path ran?** `qwenLanguageUnderstanding` — structured extraction —
   confirmed by prompt `orkestr-intent-v2` and model `qwen3.7-plus`.
2. **Why did research report "no credential"?** Because `/understand`
   **hard-coded** `research: "NOT_CONFIGURED"`. With a credential present that
   was a false statement on screen. Fixed: a new `NOT_RUN` state now says *"This
   screen does not research destinations, so nothing was asked and nothing below
   came from it."* Truthful about a subsystem that was never consulted.
3. **Was the adapter at fault?** No. The status was wrong; the failures were
   unrelated.
4. **Why 9.4s locally and 30s in production?** Instrumentation answered it
   decisively. The transport now distinguishes "no answer at all" from "answered
   but did not finish", and production reported: **"The provider did not answer
   at all within 30000ms."** `fetch` never resolved and response headers never
   arrived — so there is no model latency being measured. The production input
   was *smaller* than the local one (763 characters against 2,098 tokens), and
   the local result reproduced twice.
5. **Is `enable_thinking: false` correct for extraction?** Yes. It is `false`
   for extraction and `true` for `web_extractor`; they are opposite and both
   mandatory.
6. **Retries, context size, parsing?** None, none excessive, and none. The abort
   is ours, at exactly 30,000 ms.
7. **Should the timeout be raised?** **No.** Raising it lengthens the wait before
   the identical failure. Nothing is answering.

**Conclusion: a connectivity problem between the Vercel runtime and the Model
Studio Singapore workspace endpoint.** Network path, allow-listing or regional
reachability — a founder/infrastructure action. No code change would fix it, and
one that appeared to would only be hiding it.

Cost discipline held: **one** budgeted production call was made, and it was
instrumented first so that the single call would be decisive.

**The product degrades honestly.** The interface states that extraction did not
complete and reports what the provider actually did, rather than presenting
invented structure. Local and recorded modes are unaffected, so the demo path
does not depend on this.

---

## 13. Synthetic data and cleanup

**Every traveller used in production acceptance is fictional.** Acceptance ran
against synthetic trips only.

Acceptance nevertheless writes real rows, and rows that are fictional are
indistinguishable from real ones to every screen in the product. `npm run
db:cleanup` removes them:

* Dry run by default; deleting requires `--commit`.
* Only ids carrying a synthetic prefix are eligible.
* `ON DELETE CASCADE` handles members, private data, invitations, memberships
  and events from one statement, rather than a second hand-maintained copy of
  the schema's shape.
* `browser_session` is deliberately **not** cascaded — a browser outlives any
  one trip — so sessions stranded with no memberships are removed too.
  Eligibility is "has no memberships left", not age, so a live session with
  access is never touched.
* **No code path in it names `schema_migration`.** Deleting a migration record
  would make the next deploy reapply a migration that has already run.

At the time of writing the production database holds exactly one trip
(`prod-kdhvptf5`, the synthetic acceptance trip) and 12 orphan sessions. The
dry run reports them.

**The deletion has not been executed.** It was blocked by this environment's
safety classifier, which is the correct outcome for a destructive production
action, and I did not route around it. The founder runs:

```bash
npm run db:cleanup             # confirm what it would remove
npm run db:cleanup -- --commit # remove it
```

---

## 14. Rollback

Already documented in `PRODUCTION_RUNBOOK.md` and unchanged by Stage 4:

* **Application:** Vercel → Deployments → last known-good → *Promote to
  Production*. Nothing is deleted, so it is reversible in both directions.
* **Code:** `git revert <sha>` and push. `main` is never force-pushed.
* **Schema:** no down-migrations, deliberately — a down-migration is a script
  nobody tests that runs when things are already going wrong. The schema is
  additive, so the previous application version does not see new columns and
  does not care they exist.

The rollback target for this stage is `e760c21`, the commit before the
concurrency fix. It should not be used: it contains the silent-stale-write
defect.

---

## 15. Custom domain — recommended, not configured

**Nothing was done. DNS is untouched.**

The recommendation, with the reason that actually matters: **invite links carry
the origin**. A link forwarded to somebody's family reads `orkestr.travel/join/…`
rather than a hosting provider's subdomain, and it keeps working if hosting ever
moves. The `.vercel.app` name does not.

If it is done, the order matters, and step 2 is the one that bites:

1. Add the domain in Vercel; let the certificate issue before anything points at
   it.
2. Set `APP_BASE_URL` to the new origin in Production and redeploy. Invite links
   are built from that variable, not from the request — a domain switch with a
   stale variable produces links pointing at the old origin, issued correctly
   and wrong forever once sent.
3. Redeem one synthetic invite end to end on the new origin before announcing it.
4. Keep `.vercel.app` working. Links already sent use it.

---

## 16. Vercel Security Checkpoint

Partway through automated acceptance, Vercel began challenging non-browser
clients on this project. `curl` receives `403 Vercel Security Checkpoint`;
headless Chrome receives *"Failed to verify your browser, Code 29"*.

**A normal browser passes it and the product behaves correctly, so visitors are
unaffected.** It was most likely triggered by my own automated QA traffic from a
single address.

It matters for two reasons. It blocks scripted verification — the remaining
production checks were re-run in a real browser window — and one intermediate
test result was invalidated by it: a conflict run reported "the stale idea was
not persisted" when in fact the page had never loaded at all. That result was
discarded rather than counted, and the run repeated properly.

Worth confirming in Vercel → Firewall before a public demo.

---

## 17. Errors a stranger might hit

* An invalid invite is consumer-safe: it explains that the link no longer works,
  and offers a way forward.
* No stack trace, SQL fragment, driver class name or connection string reaches a
  page.
* When the database is unreachable, shared mode says so; the local product keeps
  working, because it never needed a database.

---

## 18. Test and gate results

| Gate | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run test` | **1,343 passed across 61 files** |
| `npm run build` | clean |
| `npm run test:bundle` | **4 passed**, with positive control |
| `npm run test:db` (live PostgreSQL) | **32 passed** |
| Shared production acceptance | **53/54** (one mis-framed assertion, section 9) |
| Non-shared public QA | **11/11** |
| Cross-origin replay | **refused, mutates nothing** |
| Production concurrency refusal | **verified live after the fix** |

Two of the 1,343 are the new guards from section 10, and both were confirmed to
fail on the previous code before the fix was written.

---

## 19. Attribution

Every commit in Stage 4 was audited before pushing. **No Claude or Anthropic
co-author metadata, `Claude-Session:` trailer, or `Generated-by:` trailer exists
in any commit.** History was not rewritten and nothing was force-pushed.

---

## 20. What is still not true

Stated plainly, because a report that only lists successes is not a report.

1. **`/understand` does not succeed end to end.** Not for the reason this report
   originally gave: Model Studio itself is now LIVE VERIFIED from production and
   the extraction completes in ~32.5 s. It is refused afterwards by the
   quote-traceability guard, which is a separate defect. Section 12.
2. **There is no custom domain**, and no DNS has been configured.
3. **There are no global user accounts**, and no email or cross-device recovery.
   Access is a browser session plus an invite link.
4. **This is not end-to-end encrypted.** Private values are access-controlled
   server-side and stored in plain text. Anyone with database access can read
   them.
5. **"Shared updates" is polling**, roughly every seven seconds while the page is
   visible. It is wired, verified, and it is not real-time.
6. **No full CSP.** Section 6, with the reason.
7. **Atlas production is not authorised** and is not representable in the type.
   Flight data shown is recorded Atlas Sandbox, never live, purchasable or
   booked.
8. **Synthetic acceptance data is still in the production database** until the
   founder runs the cleanup. Section 13.
9. **A bot challenge currently gates non-browser access.** Section 16.

---

## 21. The one thing to remember from Stage 4

A subsystem can be correct in every unit test, correct in its adapter, correct
in its database transaction, and still be **unreachable in production** because
of a single argument passed at the join between two of its halves.

The optimistic concurrency layer had a doc comment describing exactly the bug
that was live, a pure core with the rule in it, a Postgres adapter enforcing it
in a `WHERE` clause, thirty-two live database tests including two genuine races —
and none of it ran, for any real user, because the interface handed it the wrong
number.

Deploying is what found it. Nothing else would have.
