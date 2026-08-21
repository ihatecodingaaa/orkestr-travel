# Accessibility and Assistance

**Status:** `IMPLEMENTED` across the domain, the extraction layer and the
evidence layer. **No provider integration exists**, so the feasibility engine
still reports every assistance constraint as `DEFERRED_TO_LATER_PHASE` rather
than assessing it, and no operator has confirmed anything.

**In wave planning (Phase 2):** an assistance requirement makes its wave
`UNRESOLVED`, and therefore its whole plan `UNRESOLVED`. It is never dropped and
never quietly satisfied.

**In compromise and repair (Phase 3):** the uncertainty survives untouched, and
a test asserts it. An assistance requirement is NOT treated as a blocker in the
compromise frontier, but for a specific reason: it is structurally unresolvable
in this phase, applies identically to every candidate, and so cannot distinguish
one plan from another. Blocking on it would make compromise impossible for any
group containing an assistance need, punishing exactly the travellers this
product exists to serve. It stays in the plan's `unresolved` list and still
forces the plan state to `UNRESOLVED`, so a repaired plan is never reported as
fully provider-ready.

**In the interface (Phase 5):** a stated need renders with TWO separate badges,
and a test asserts they never merge:

```
Step-free access
  [Confirmed by traveller]        she said so
  [Needs airline confirmation]    nobody has asked; no airline is connected
```

The provider badge can only reach a positive tone when a provider genuinely
said yes, which nothing in this build can produce. A need marked SENSITIVE is
withheld from group surfaces entirely, because in a small party even an
unattributed mention identifies the person.

### Accessibility OF the interface

Semantic HTML throughout, with `article`, `section`, `nav` and heading structure
rather than nested `div`s. Every control is a real link or button, so keyboard
navigation works without any handler of ours. Focus is always visible and never
removed. Colour never carries meaning alone: every truth badge pairs a colour
with a word and a shape glyph. Motion is decoration only and is removed entirely
under `prefers-reduced-motion`. The preservation percentage is `aria-hidden`
because on its own it reads as "nothing happened"; the counts carry the meaning.

**In extraction (Phase 6):** a need exists only where the text states it. The
extraction prompt forbids inferring one from an age, a family role or a
companion; the evaluation set contains a case that fails if a model reads "my
mother who is 78" as a mobility requirement; and the mapper never assigns an
age band at all, because age is person-supplied and text written *about*
somebody is not that person supplying it.

An extracted need arrives `SENSITIVE`, `confirmedByOwner: false` and
`operationalStatus: UNKNOWN`. Three separate facts, none of them assumed.

**In research (Phase 6):** an accessibility claim with no official or provider
source behind it is downgraded **in code** to a community signal that needs
confirmation. A suggestion for a group with a stated movement need is not
refused when no official page exists, because refusing every venue without one
would quietly exclude the person with the need from the trip. It is allowed
through carrying `ACCESSIBILITY_UNVERIFIED` and an explicit task to check with
the venue. What never happens is the claim being shown as settled.

**In the journey package (Phase 4):** the need appears as an `ASSISTANCE_TASK`
item with status `NEEDS_CONFIRMATION`, and as a
`PROVIDER_ASSISTANCE_CONFIRMATION` entry in the package's decisions-needed list.
The pre-flight plan also allows extra airport lead time for the wave carrying
that traveller, which is the one adjustment the domain can make honestly from
information it actually holds.

```
Requirement   step-free access
Traveller     CONFIRMED (she stated it)
Provider      UNKNOWN   (nobody has been asked; no provider exists)
Action        NEEDS_PROVIDER_CONFIRMATION
```

A test asserts every assistance item stays at `NEEDS_CONFIRMATION`. It is never
labelled verified. A group where one traveller needs step-free access will
see a plan that says plainly it cannot yet confirm that requirement.

What IS enforceable today is the relationship. A traveller who states a
must-travel-with companion is grouped with them structurally, so a caregiver is
never separated from the person they travel with, even though the airline's
ability to provide assistance remains unconfirmed. Those two facts are tracked
separately and must never be conflated.

A naming note that matters: the operational status uses `PROVIDER_CONFIRMED`, not
`CONFIRMED`, so it can never be confused with `AssistanceNeed.confirmedByOwner`.
Those are confirmed by different parties. The traveller confirms the need is
real; only the operator can confirm it can be met.

## 1. Two rules, stated first

**Rule 1: an assistance need is never inferred.** Not from an age band, not from
a photo, not from a name, not from a relationship. A need exists because a person
stated it. The type carries `statedBy`, and there is deliberately no
"derived from age" origin to select.

**Rule 2: needing assistance and being able to get it are different facts.** A
traveller's need can be confirmed while the airline's ability to meet it remains
unconfirmed. Those are stored separately and displayed separately.

## 2. Assistance needs

Wheelchair assistance, airport mobility assistance, limited walking distance,
step-free access, elevator required, frequent rest breaks, travelling with an
infant, sensory sensitivity, medical equipment luggage, caregiver required, and
a custom free-text need.

A confirmed assistance need may become a **hard** constraint. It is then subject
to every hard-constraint rule: never silently violated, never relaxed
automatically.

## 3. Provider support states

| State | Displayed as |
| --- | --- |
| `PROVIDER_CONFIRMED` | The operator has confirmed it can meet this need |
| `PROVIDER_DECLINED` | The operator has said it cannot |
| `NEEDS_CONFIRMATION` | Not yet confirmed. **Never shown as verified** |
| `UNKNOWN` | We have not been able to ask |

There is no path from community evidence to `PROVIDER_CONFIRMED`. If the provider
cannot confirm an assistance service, the product says `NEEDS_CONFIRMATION` and
creates a handoff task. It does not say "accessible".

## 4. Age bands

Age information is optional, supplied or approved by a person, and never
estimated from a profile or photo.

Age may influence **discovery**: what to research, what to suggest. It must never
create an assistance requirement, never set the trip pace on its own, and never
become a hard constraint. Explicit assistance requirements always take
precedence over any age-derived assumption.

In Phase 6 this is concrete. A research question carries volunteered age bands
as a **count** ("1 older adult, 4 adults, 1 teen, 1 child"), immediately
followed by: *use this only to check that everybody could take part, do not
infer anybody's interests from it*. Stated interests appear BEFORE the age mix
and are labelled "these matter most". The prompt separately forbids guessing
the age of the people who wrote the sources. `tests/prompts.test.ts` asserts
all of it, including the ordering.

Language matters here. Bands are used to shape research queries such as
"multigenerational family itinerary Tokyo", not to make assumptions about what a
person can do.

## 5. Relationships

`mustTravelWith` is hard and is never inferred. A caregiver relationship is
recorded because somebody said so, not because two travellers share a surname or
an age gap. `preferTravelWith` is soft.

## 6. Test obligations

An assistance need that becomes a hard constraint; a need with an unconfirmed
provider that must display `NEEDS_CONFIRMATION`; community evidence that must
fail to satisfy an accessibility requirement; an older traveller with no stated
need who gets no inferred requirement; and a `mustTravelWith` caregiver pair that
the wave engine must not separate.

**All discharged.** `tests/evidenceLayer.test.ts` asserts a community-sourced
accessibility claim is downgraded and needs confirmation;
`tests/suggestionChecks.test.ts` asserts a community claim cannot clear a stated
movement need while an official one can; `tests/evalCases.test.ts` asserts the
scorer fails a reading that infers a need from somebody being 78; and
`tests/intentMapping.test.ts` asserts an extracted need arrives SENSITIVE,
unconfirmed by its owner and UNKNOWN to any provider.
