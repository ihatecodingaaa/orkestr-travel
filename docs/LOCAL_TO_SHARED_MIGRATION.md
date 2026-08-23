# Turning a local trip into a shared one

The hard part is not moving the data.

---

## The problem

A local trip was filled in by **one person**, and some of what they typed is
about **other people**.

The organiser wrote *"Zen: free 7–22 Sep"* because they were guessing, or
because Zen said something in a group chat three weeks ago. In a single-user
prototype that is a helpful placeholder.

The moment Zen can open the trip themselves, presenting it as Zen's answer is a
lie the product tells on Zen's behalf — and every downstream guarantee inherits
it. *"4 of 5 ready"* becomes false. *"Everyone is together on the 7th"* becomes
a plan built on something nobody confirmed.

## The rule

**Migration downgrades other people's details to drafts.**

| Whose data | Authority after migration |
|---|---|
| The organiser's own | `CONFIRMED_BY_OWNER` — they really did say it |
| Everybody else's | `ORGANISER_DRAFT` — kept, shown to its owner, not counted as an answer |

Zen still sees what the organiser guessed, labelled as a guess, with one tap to
confirm. Nothing is thrown away and nothing is claimed.

## Private data entered for somebody else

If the organiser recorded something private for another traveller, it moves into
**that traveller's** private storage — and the organiser can no longer see it.

It is also not claimed as that person's word: it arrives as a draft, like the
rest of their details.

The organiser is warned before this happens, because a value silently
disappearing from their view looks like data loss:

> Private details you entered for Mum move to their own private area. You will
> not be able to see them afterwards.

## The flow

```
1  Preview      planMigration() -> what moves, what becomes a draft, warnings
2  Confirm      the organiser sees all of it before anything happens
3  Create       one transaction: trip, members, private data
4  Verify       read the shared trip back
5  Link         only now is the local trip marked as shared
6  Keep         the local copy stays as a backup until deleted deliberately
```

Steps 4 and 5 are in that order on purpose. Marking the local trip as migrated
before confirming the server has it is how somebody ends up with neither.

## What moves as-is

Ideas, plan items, budget lines and autopilot settings. They were always
group-visible, and they carry no authority claim about a person.

Private requirements are removed from the shared payload by
`stripPrivateForSharing`, once, in one place. The **count** survives so the
group is still told a constraint exists — otherwise the plan appears to change
for no reason.

## No duplicate truth

Once a trip is shared, **the server is authoritative**.

A local cache may exist for speed or offline display. It is not an independent
copy that can be edited in parallel, because two editable copies of one trip is
two trips that disagree.

The pre-migration local trip is kept as a **backup** — read-only, clearly
labelled, deletable by the person who owns it.

## What is not built

Migration back from shared to local. A trip with four people who have joined and
answered is not something one member should be able to pull back onto their own
device.
