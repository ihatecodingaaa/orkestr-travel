# The shared-trip security model

What protects a shared trip, stated so that each claim can be checked against
the code.

---

## What is true

* Invite tokens are **256 bits from a CSPRNG**. Only a SHA-256 hash reaches the
  database.
* Session tokens are the same, in an **HttpOnly, SameSite=Lax, Secure** cookie.
  The cookie is an opaque lookup key with no claims in it.
* **Private values are access-controlled server-side and never sent to other
  travellers.** Not hidden with CSS, not filtered in React — never serialised
  into the response at all.
* Identity comes from the session. Nothing a client sends says who it is.
* Every state-changing operation is a POST server action with an origin check.
* Trip and invite pages are excluded from search indexing.

## What is NOT true

**This is not end-to-end encrypted.** Private requirements are stored in plain
text in PostgreSQL. Anybody with database access — a hosting provider's staff, a
person with the connection string, an attacker who obtains a dump — can read
them.

The honest claim is *access-controlled server-side*, not *encrypted*. Saying
otherwise would be the one lie that makes every other statement here worthless.

**There is no global account.** A cookie is the only proof of identity. Lose the
cookie and you lose access until the organiser sends a new invite.

**"Shared updates" is polling, not real-time.** Roughly every seven seconds
while the page is visible, stopping when it is hidden.

---

## Threat model

| Threat | What stops it | Residual risk |
|---|---|---|
| **Guessing an invite** | 256-bit random token; a wrong token is indistinguishable from a revoked one | None worth modelling |
| **Guessing a trip URL** | Trip access needs a session membership; "not a member" and "no such trip" return identical answers | None |
| **Stolen invite link** | One use only, seven-day expiry, revocable | Whoever opens it first joins as that member. Mitigation is revoke + reissue |
| **Forwarded invite** | Same as above | Same. An invite is a bearer token; the product says so |
| **Reused invite** | Redemption is claimed inside the UPDATE, so two taps yield one join | None |
| **Session theft (XSS)** | HttpOnly cookie; no token in localStorage; React escapes by default; no `dangerouslySetInnerHTML` | An XSS could still act as the user in-page |
| **Session theft (network)** | Secure cookie in production | A compromised TLS chain — see the `ssl` note in `db.ts` |
| **CSRF** | Server actions are POST with an origin check; SameSite=Lax; no GET mutates | None known |
| **Cross-trip access** | Membership is per trip; a member of A resolving against B is refused | None |
| **Organiser reading private values** | `canReadPrivate` compares against the owner, not the role; the query for counts does not select the values | The organiser can see that a constraint exists and how many |
| **Traveller editing another traveller** | `canEditMember` compares ids | None |
| **Token in a URL** | Redeemed once, then redirected away; `referrer: no-referrer`; `noindex` | The token is in browser history until it is redeemed. It is dead after |
| **Token in logs** | Never logged. `redactToken` exists for the "just print it" moment; migration and connection errors surface class names only | A host's own request logs may record the path |
| **Database leak** | Token hashes only | **Private requirement text is readable.** Stated above |
| **Stale browser overwriting** | Optimistic version in the UPDATE's WHERE clause | None |
| **Malformed local import** | Parsed and validated at the boundary; other people's data enters as drafts | None |
| **Private data in group HTML** | Never serialised; asserted with a sentinel value in tests | None found |

---

## Input handling

Names, idea titles, notes and links are user input.

* Rendered as text. React escapes it, and no `dangerouslySetInnerHTML` exists in
  the product screens.
* URLs are checked for scheme: `http` and `https` only. `javascript:`,
  `data:` and `vbscript:` are rejected.
* A pasted link is **stored and never fetched**, so it is not an SSRF surface.

## Verified against a real database

Not reasoned about — measured, on PostgreSQL 17.6 with two isolated browser
profiles:

* The sentinel private value appears in **no** response to the organiser or to
  another traveller — HTML and RSC payload, checked after confirming the payload
  was real rather than an empty redirect.
* **No 43-character token-shaped string** appears anywhere in the share page,
  scripts included.
* An invalid invite token reveals nothing about the trip and produces the same
  words as a revoked one.
* The session cookie is `HttpOnly`, `SameSite=Lax`, `Secure`, and unreadable
  from page script.
* Two browsers hold different sessions; a third with none is refused.
* Redeeming the same link twice yields one join and one refusal — as a real
  race, both issued before either resolved.
* No `DATABASE_URL`, connection string, driver or token helper reaches any
  browser bundle.

## Reporting

If something here is wrong, it is a bug in this document as much as in the code.
Both should change together.
