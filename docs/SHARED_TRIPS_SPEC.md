# Shared trips

Stage 1 made Orkestr usable. Stage 2 made it interactive. Stage 2.5 made it
worth looking at. Stage 3 makes it **real for a group**.

> Plan together without doing the planning together.

Stage 3 is where that sentence becomes literally true rather than aspirational.

---

## The moment this exists for

```
Lucas creates a Seoul trip
  adds Mum, Dad, Zen and Tit
  Orkestr gives each of them their own invite
  the links go out through WhatsApp
each traveller opens their own Orkestr view
  answers THEIR OWN questions
  their private details stay private
the shared trip updates for everybody
  and a later change is repaired, not rebuilt
```

Nobody shares a password. Nobody fills in a form on somebody else's behalf.
Nobody has to read a spreadsheet.

## Two modes, and the product says which

| | On this device | Shared with your group |
|---|---|---|
| Storage | `localStorage` | PostgreSQL |
| Who can open it | This browser | Anyone the organiser invited |
| Needs configuration | No | `DATABASE_URL` |
| Identity | None needed | A session per browser |

**Local trips keep working with nothing configured.** Clone the repository, run
it, make a trip, explore, plan, run a what-if — all of it, with no database.
Sharing is an additional capability, not a prerequisite. When it is not
configured, the controls say so; they never pretend to make an invite.

## No account

A person invited to a holiday should not have to create an account to say which
days they can travel. A signup wall in front of a group trip is where most of
the group stops.

So identity is **trip-scoped and anonymous**: an opaque session cookie, holding
memberships. One browser can be the organiser of Seoul and a traveller on Bali
without two identities.

**The cost, stated plainly:** lose the cookie and you lose access until the
organiser sends a new invite. There is no email recovery, because there is no
email. A future account can bind to existing memberships without the trip data
moving — see [Identity and invites](IDENTITY_AND_INVITES.md).

## Who may do what

| | Organiser | Traveller |
|---|---|---|
| Edit destination and dates | ✓ | |
| Add people, create and revoke invites | ✓ | |
| Edit the canonical itinerary | ✓ | |
| Apply a group-wide change | ✓ | |
| Save and add ideas | ✓ | ✓ |
| Edit **their own** availability and requirements | ✓ | ✓ |
| Answer **their own** questions | ✓ | ✓ |
| Read somebody else's private value | | |
| Answer somebody else's question | | |
| Accept a compromise for somebody else | | |

The bottom three rows are empty for **everyone, including the organiser**. That
is the product, not a limitation to relax later: it is the reason a group would
trust this with a budget ceiling they have not told their family about.

Everyone contributes ideas. A trip where only the organiser may suggest dinner
is a trip the group stops opening. Everything that rewrites the shared itinerary
is the organiser's, so a group plan does not become a document four people are
quietly overwriting.

## Private is structural

The group is told a private requirement **exists**. Its owner is told what it
**says**. Nobody else is told anything more.

This is not achieved by hiding a field. Owner-only values live in a separate
table that no group query touches, and the actor-aware view builders decide what
is *serialised at all*. A value that never enters the response cannot be found
in view-source, in a React payload, or by a person scrolling a debugger.

The group is told *something* deliberately: a plan that changes for no visible
reason is worse than one that says somebody has a constraint.

## Two people at once

Every shared write states the version it was made against. If the trip moved,
the write is refused and the client reloads, keeping what the person typed.

The failure this prevents is silent: Mum saves a note she started before Zen
changed their dates, Zen's change disappears, nobody sees an error, and the trip
is simply wrong.

A conflict is a normal outcome. The message says so:

> The trip changed while you were editing. Orkestr has refreshed it — please
> check your change still makes sense.

## Shared updates, not real-time

Roughly every seven seconds while the page is visible; nothing while it is
hidden; immediately on focus. A poll returns a version number, and the trip is
only refetched when that number moved.

The interface calls this **"Shared updates"**. It does not say real-time,
because it is not, and the architecture keeps a seam so a WebSocket or SSE
transport can replace polling without the rest changing.

## What Stage 3 is not

No hotel booking, weather, maps, payments, social scraping, global accounts,
travel documents or calendar sync. Shared group coordination is enough.

---

**See also:** [Identity and invites](IDENTITY_AND_INVITES.md) ·
[Data model](SHARED_DATA_MODEL.md) ·
[Security model](SHARED_SECURITY_MODEL.md) ·
[Local to shared](LOCAL_TO_SHARED_MIGRATION.md)
