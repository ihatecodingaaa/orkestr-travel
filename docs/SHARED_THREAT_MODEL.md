# Shared trips: threat model

Written as scenarios, because a list of controls tells you what exists and a
list of scenarios tells you what happens.

Controls and residual risk live in
[the security model](SHARED_SECURITY_MODEL.md); this is the reasoning behind
them.

---

## An invite link leaks

**Somebody forwards Zen's link into the wrong chat, or it appears in a screenshot.**

An invite is a **bearer token**. Whoever opens it first joins as Zen. There is
no second factor, and pretending otherwise would be the dangerous part.

What limits the damage: it works once, expires in seven days, and the organiser
can revoke it. The share screen shows who has actually joined, so the organiser
can see that Zen is marked joined before Zen says they have joined.

**Not mitigated:** an attacker faster than Zen. The fix is revoke and reissue.

## Somebody tries invite links at random

256 bits. This is not a threat that needs mitigating; it needs arithmetic.

More usefully: **an unknown token produces the same response as a revoked one**,
so responses cannot be used to learn which tokens ever existed.

## Somebody guesses a trip URL

Trip ids are not secrets — they appear in URLs and in local storage. Access is
membership, checked server-side against a session.

**"You are not a member" and "no such trip" return the identical message**, so
a stranger cannot use the difference to enumerate trips.

## The organiser wants to see Mum's budget

This is the scenario the product exists to refuse.

`canReadPrivate` compares the actor against the **owner**, not against a role.
There is no admin path, no override, and no organiser branch. The count query
does not select the values column, so even a careless future query cannot return
one.

The organiser learns that Mum has a private requirement and how many. That is
deliberate: a plan that changes for no visible reason is worse than one that
says somebody has a constraint.

## A traveller answers for somebody else

Every question has an owner. `canAnswerFor` compares ids.

**A private question's text is replaced entirely for other readers** — not just
its answer. "This option is $42 above your limit of $650, is that okay?" gives
the value away as surely as the answer does. Others see "Mum has a private
question to answer".

## A stale browser overwrites a newer trip

Mum opens the trip. Zen changes their dates. Mum saves a note she started before
that.

Without a version check, Zen's change disappears, nobody sees an error, and the
trip is simply wrong — the worst kind of bug, because it is invisible and gets
blamed on whoever looked last.

The version goes in the `WHERE` clause. Mum's write is refused, her input is
kept, and she is told the trip moved.

## An XSS in a name or an idea title

Names, titles, notes and links are user input rendered as text; React escapes
it, and no `dangerouslySetInnerHTML` exists in the product screens.

Links are the sharp edge, so they are **validated at the boundary, not at
render**: only `http` and `https` survive `addIdea`. A `javascript:` URL is
dropped rather than stored-and-hidden, because a dangerous value in storage is
one careless component away from being an anchor.

The session cookie is `HttpOnly`, so an XSS cannot read it. It could still act
as the user within the page — that is the honest residual risk.

## CSRF

State-changing operations are POST server actions with Next's origin check, and
the cookie is `SameSite=Lax`. **No GET route mutates anything** — including
joining, which is why opening an invite link does not consume it.

## A token ends up in a log or a Referer header

Redemption redirects immediately to a plain trip URL, so the token is gone from
the address bar and from any later Referer. The invite page sets
`referrer: no-referrer` for the moment before that, and carries `noindex`.

Nothing logs a token. `redactToken` exists for the "just print it while
debugging" moment. Migration and connection errors surface **error class names
only**, because the `pg` driver embeds the connection string in some messages.

**Residual:** a host's own request logs may record the path. That is why the
token dies on first use.

## The database is stolen

Token hashes only — invites and sessions both — so a dump yields no usable
links or cookies.

**Private requirement text is readable.** It is stored in plain text. This is
not end-to-end encrypted and the docs say so; claiming otherwise would be the
one lie that makes every other claim here worthless.

## A malformed local trip is imported

Parsed and validated at the boundary, as local trips already were. Other
people's details enter as **drafts**, so a malformed or optimistic local trip
cannot manufacture confirmations.

## Private data reaches the group's HTML

The failure mode that would matter most, so it is tested rather than reasoned
about: a sentinel value is asserted **present** before stripping and **absent**
from every non-owner view.

Because privacy is structural — a separate table and actor-aware builders that
decide what is serialised at all — there is no render-time filter that could be
forgotten.
