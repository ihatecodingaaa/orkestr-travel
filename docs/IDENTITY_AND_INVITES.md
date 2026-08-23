# Identity and invites

How somebody becomes a person on a trip, without creating an account.

---

## The chain

```
organiser adds "Zen"      -> a TripMember exists, nobody can open it yet
organiser copies a link   -> a TripInvitation; 256-bit token, only its hash stored
Zen opens the link        -> a preview. NOTHING is consumed
Zen presses Join          -> the invitation is claimed, a session is created,
                             the session gains a membership,
                             the URL is replaced by a plain trip URL
```

## Tokens

256 bits from a CSPRNG, base64url so no escaping is needed. Only a SHA-256 hash
reaches the database.

Unsalted SHA-256 is **correct here** and would be **wrong for a password**. A
password is low-entropy and human-chosen, so it needs slow hashing to survive a
dictionary attack. These are 256-bit random values: there is no dictionary, and
a fast hash costs an attacker nothing they did not already lack.

The raw token exists long enough to reach a clipboard, and then it is gone. It
is not stored, not logged, and not in any view model — which is why **"copy
again" issues a new link** rather than re-reading the old one. A token you can
look up later is a token sitting somewhere readable.

## Opening a link does not consume it

A person taps an invite in a group chat, sees what they are joining, gets
interrupted by the same group chat, and comes back. Redemption happens on the
button.

That is also why joining is a POST server action and not a GET route: no route
in the product redeems an invitation by being fetched, so a link-preview bot
cannot burn an invite before the human sees it.

## Lifecycle

| State | Cause | What the person is told |
|---|---|---|
| Ready | Just created | — |
| Redeemed | Somebody joined with it | "This invite has already been used. Ask the organiser for a new link." |
| Revoked | Organiser revoked it | "This invite is no longer valid. Ask the organiser for a new link." |
| Expired | Seven days passed | "This invite has expired. Ask the organiser for a new link." |

**An unknown token gets the same words as a revoked one.** Anything more
specific would confirm to somebody trying values that a particular token once
existed.

Revoked outranks expired outranks redeemed: somebody who revoked a link wants it
dead regardless of what else is true of it.

**Redemption is claimed inside the UPDATE**, so two taps on one link produce one
join and one "already used" — not two sessions.

## Sessions

A cookie holding an opaque random token. No trip id, no member id, no role, no
signed claims: it is a lookup key, so it cannot be forged and does not go stale
when access is revoked.

| Attribute | Value | Why |
|---|---|---|
| `HttpOnly` | always | Script-readable storage turns one XSS into a permanent takeover |
| `SameSite` | `Lax` | An invite arrives cross-site from WhatsApp, and `Strict` would drop the cookie on exactly that navigation. `Lax` still refuses cross-site POSTs |
| `Secure` | production always | The only exception is plain-http localhost, where a Secure cookie is never stored and development stops working. There is no flag to weaken it |
| `Max-Age` | 90 days | Long enough to plan a trip, short enough to expire |

One session, several memberships. Organiser of Seoul and traveller on Bali is
one cookie and two rows.

## The honest limitation

**Lose the cookie, lose the access.** Clearing site data, a new device, or a
different browser means starting again — the organiser reissues an invite.

This is the deliberate cost of not putting a signup wall in front of a holiday.
It is documented rather than hidden, and the organiser always has the fix.

## The future-account seam

A global account (Google, Apple, an email magic link) attaches to
`session_membership` rows. Nothing about the trip data changes, and travellers
do not re-enter anything: an account becomes another way to reach the same
memberships, and cross-device recovery follows from that.

Stage 3 does **not** implement this, and does not pretend to have solved global
identity.

## What "View as" became

Stage 2.5 had a "Viewing as" control, honestly labelled a prototype affordance
because there were no accounts.

In shared mode it is **gone**. Identity comes from the session; there is no
query parameter that changes who you are. It survives only in the local example
trip, where there is one reader and nothing to protect.
