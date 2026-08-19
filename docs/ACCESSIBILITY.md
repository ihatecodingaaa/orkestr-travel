# Accessibility and Assistance

**Status:** types `IMPLEMENTED` (`src/domain/assistance.ts`). No provider
integration exists, and the feasibility engine deliberately reports every
assistance constraint as `DEFERRED_TO_LATER_PHASE` rather than assessing it.

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
