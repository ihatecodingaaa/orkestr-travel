# Evidence Model

**Status:** types `IMPLEMENTED` (`src/domain/evidence.ts`); no research
implementation exists.

## 1. Purpose

Record where every claim came from, and enforce what each kind of source is
allowed to establish.

## 2. Source types

| Source type | May establish |
| --- | --- |
| `ATLAS_PROVIDER_FACT` | Flight facts from the provider response |
| `OFFICIAL_FACT` | Operational facts from an operator, venue or government source |
| `COMMUNITY_SIGNAL` | Experience only. Never an operational fact |
| `EDITORIAL_SOURCE` | Published editorial context |
| `USER_SHARED` | What the user showed us, as their input, not as truth |
| `INFERRED` | A reading between the lines. Never authoritative alone |
| `CONFLICTING` | Sources disagree. Shown as a disagreement |
| `UNKNOWN` | Nothing established this |

## 3. The rule that matters most

**Community evidence may describe experience. It may never establish an
operational fact.**

| Community evidence may inform | Community evidence may never establish |
| --- | --- |
| Vibe, crowding, queue experience | Wheelchair accessibility |
| Value for money, photogenic spots | Allergy safety |
| Family or teen suitability | Opening hours |
| Noise, service consistency | Certified dietary status |
| Recommended dishes, local tips | Booking availability, flight availability |

Ten reviews saying "step-free, no problem" do not make a venue accessible. That
requires an official source, and until one exists the status is
`NEEDS_CONFIRMATION`.

## 4. Freshness

Every piece of evidence records when it was retrieved, and where discoverable,
when the source itself was published. Freshness is **computed** from those
timestamps, not asserted. `UNDATED` is a real value for sources with no
discoverable date.

## 5. Confidence

`inferenceConfidence` exists only for `INFERRED` evidence. A published opening
time does not have a confidence score; it has a source. Attaching confidence
numbers to facts is false precision.

## 6. Community summaries

A summary states the real number of sources actually read. If two sources exist,
it says two. Fabricating "based on 47 reviews" would be the easiest and most
damaging lie this product could tell, so the count is carried as data rather than
written as copy.

Disagreements between sources are shown, not averaged away.

## 7. Traceability

Every factual reason shown to a user in a "why this fits your group" explanation
must carry either an evidence id or a flag saying it was checked
deterministically by code. A claim with neither may not be displayed.
