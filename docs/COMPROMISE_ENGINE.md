# Compromise Engine

**Status:** `IMPLEMENTED` (Phase 3).

Code: `src/core/compromise/` (relaxation, exceptions, frontier, engine).
Types: `src/domain/compromise.ts`. Covered by 32 tests.

---

## 1. Purpose

Answer one question:

> What is the smallest set of explicit, owner-approved soft changes that makes
> this trip acceptable?

A plan can be perfectly feasible and still miss somebody's stated preference.
Proceeding anyway would mean the system quietly decided that a preference did not
matter. The compromise engine turns that into an explicit ask, put to the one
person whose preference it is.

## 2. Eligibility

A candidate plan qualifies when it has:

- **zero confirmed hard violations** (guaranteed: the wave search never builds a
  plan containing one), and
- **zero blocking unknowns** (see section 4), and
- one or more relaxable soft violations or preferred-pair separations.

Candidates needing nothing from anybody are still examined, because their
existence is what makes `NO_COMPROMISE_NEEDED` the right answer rather than an
invented ask.

## 3. Hard, soft and unknown

| Strength | Treatment |
| --- | --- |
| `HARD` | **Never a candidate.** Not relaxed, not proposed, not negotiated |
| `SOFT` | The only thing that can be relaxed, and only with owner approval |
| `UNKNOWN` | **Never relaxable.** Evidence is missing; that is not a preference |

When only hard requirements block a trip, the engine returns
`HARD_CONSTRAINT_CHANGE_REQUIRED` and names the blockers. **It does not decide
which requirement somebody should give up.** A later interface may ask the group
whether anyone wants to reconsider something; the core must not choose for them.

The refusal is structural, not conventional: `relaxationFor` returns nothing
unless `constraint.strength === "SOFT"`, so a hard requirement cannot become a
relaxation even through a mistaken refactor.

## 4. The frontier, and why runnersUp is not enough

This is the most important design decision in Phase 3.

Phase 2 returns `runnersUp`: the plans that survived its pruning. That pruning is
**correct for planning**. Once a two-wave plan is found, a three-wave branch can
never rank better *as things stand*, so exploring it is wasted work.

**But compromise changes what "as things stand" means.** A plan that ranks poorly
under the current preferences may be the one that needs the smallest concession
from the fewest people, and Phase 2 will have thrown it away before it ever
became a complete plan.

Building the compromise engine on `runnersUp` would therefore make it
systematically blind to its own best answers, and **the blindness would be
invisible**: the engine would still return something plausible.

So the frontier runs its own enumeration through `enumerateCandidatePlans` with
`retainAllPlans: true`.

### retainAllPlans is bounded

> **`retainAllPlans` means "retain all plans WITHIN THE BOUNDED SEARCH". It does
> NOT mean unlimited combinatorial enumeration.**

`maxWaves` is checked **before** the `retainAllPlans` early-return, and
`maxPlansExplored` is checked independently of pruning altogether, at the top of
every recursion step. What is dropped is only the ranking-driven prune: the one
that discards a branch because it cannot beat the best plan found so far.

### Complete search versus search limit reached

| | Meaning |
| --- | --- |
| `searchLimitReached: false`, `minimalityProven: true` | The space was exhausted within the bounds. The smallest compromise found **is** the smallest that exists |
| `searchLimitReached: true`, `minimalityProven: false` | The search stopped early. A compromise may still be returned, but **minimality is NOT proven** and it must not be described as the minimum |

`minimalityProven` is deliberately redundant with `!searchLimitReached`. A single
boolean named for the claim being made is much harder to misread than a flag the
caller has to remember to invert, and this is a claim nobody should make by
accident.

### The regression, proved rather than asserted

`frontierRegressionGroup` in `src/fixtures/repairScenarios.ts`:

```
Xan   Tuesday, SOFT budget preference of 300 SGD
Yara  Tuesday, HARD rule: no departure before 10:00
Zed   Wednesday

TUE_LATE   14:00, 400 SGD   the only Tuesday flight Yara can take
TUE_EARLY  07:00, 310 SGD   Yara's hard rule excludes her
WED        09:00, 420 SGD
```

Phase 2 selects `{Xan,Yara}` on TUE_LATE plus `{Zed}` on WED, needing Xan to
stretch by **100 SGD**, and returns an **empty `runnersUp`**: the three-wave
alternative was pruned before completion.

The compromise engine still finds that three-wave plan, which needs Xan to
stretch by only **10 SGD**.

> The fixture's **offer order is deliberate and commented in the code**. Listing
> TUE_LATE first is what makes Phase 2 find the two-wave plan first and therefore
> actually prune. Without that ordering the three-wave plan is discovered first,
> retained, and the test would pass vacuously while proving nothing.

### Blocking unknowns

| Unknown reason | Blocks a candidate? |
| --- | --- |
| `OFFER_DATA_MISSING` | Yes |
| `CONSTRAINT_UNCONFIRMED` | Yes |
| `CURRENCY_MISMATCH` | Yes |
| `CONSTRAINT_MALFORMED` | Yes |
| `DEFERRED_TO_LATER_PHASE` | **No** |

The first four are all things a person or better data could settle now, and a
compromise must never be offered as a way around them.

`DEFERRED_TO_LATER_PHASE` is excluded deliberately. Those unknowns are
structurally unresolvable in this phase (assistance needs a provider that does
not exist), they apply identically to every candidate, and so they cannot
distinguish one plan from another. Treating them as blockers would make
compromise impossible for **any group containing an assistance need**, which
would punish exactly the travellers this product exists to serve. They remain in
the plan's `unresolved` list and still force the plan state to `UNRESOLVED`, so
nothing is hidden.

## 5. Relaxation types

A kind exists only where the deterministic domain can compute its magnitude
exactly. Nothing is invented for expressive convenience.

| Kind | From constraint | Unit |
| --- | --- | --- |
| `BUDGET_INCREASE` | `BUDGET_MAX` | currency minor units |
| `EARLIER_DEPARTURE` | `DEPART_NOT_BEFORE` | minutes |
| `LATER_DEPARTURE` | `DEPART_NOT_AFTER` | minutes |
| `LATER_ARRIVAL` | `ARRIVE_BY` | minutes |
| `ADDITIONAL_STOP` | `MAX_STOPS` above 0 | stops |
| `RELAX_DIRECT_PREFERENCE` | `MAX_STOPS` of 0 | stops |
| `REDUCE_BAGGAGE_REQUIREMENT` | `CHECKED_BAGS_REQUIRED` | count |
| `ALTERNATE_AIRPORT` | airport allow-lists | count |
| `DATE_WINDOW_RELAXATION` | `AVAILABLE_DATES` | days |
| `SEPARATE_PREFERRED_TRAVELLERS` | `preferTravelWith` relationship | count |

The mapping is an exhaustive `switch` over `ConstraintValue`, so adding a
constraint kind **fails the build** until somebody decides whether it is
relaxable. Silently having no relaxation for a new soft constraint would mean
quietly ignoring somebody's preference.

`SEPARATE_PREFERRED_TRAVELLERS` is the one relaxation not derived from a
constraint record, because `preferTravelWith` lives on the relationship. It uses
a deterministic synthetic identity (`PREFER_TOGETHER:<a>+<b>`, built from the
sorted pair) so the type stays uniform and the id stays stable. Both travellers
receive their own relaxation, because being separated affects them both and
neither may answer for the other.

`originalValueLabel` and `proposedValueLabel` are **display only**. The typed
fields are authoritative, so nothing downstream parses prose to learn what was
agreed.

## 6. Ranking

Strictly lexicographic. Each criterion applies only when everything above it ties.

| # | Criterion | Why here |
| --- | --- | --- |
| 1 | Fewest affected travellers | Asking one person beats asking two, whatever the sizes |
| 2 | Fewest relaxed constraints | One stretch beats two, even from one person |
| 3 | Smallest magnitude, when comparable | See below |
| 4 | Fewest existing decisions disturbed | Only when a plan is already in force |
| 5 | Lowest soft inconvenience | The Phase 2 measure |
| 6 | Stable tie-break on fingerprint | So the answer never wobbles |

### On comparing magnitudes

Magnitudes are summed **per unit**, with currency folded into the money unit
(`CURRENCY_MINOR:SGD`). Two candidates are compared only when their unit sets
match exactly.

**SGD 20 and 45 minutes have no honest conversion between them.** When the unit
sets differ the criterion is **skipped**, and the comparison falls through to the
next one, rather than being resolved with an invented exchange rate.

Summing magnitudes within a single unit is a stated **product assumption**, not
a measured utility.

## 7. Ownership and approval

Every relaxation names exactly one `ownerTravellerId`. A proposal lists every
traveller whose approval it needs, and each of them approves only their own.

**The organiser cannot accept on somebody else's behalf**, and one traveller
cannot accept for another.

`acceptCompromise()` is the only supported way to create an `AcceptedCompromise`,
and an approval from the wrong person is an **explicit typed failure**:

| Code | When |
| --- | --- |
| `UNAUTHORIZED_COMPROMISE_APPROVAL` | The approver does not own the constraint |
| `UNKNOWN_CONSTRAINT` | The constraint is not on this trip |
| `UNKNOWN_TRAVELLER` | The approver is not on this trip |
| `CONSTRAINT_NOT_RELAXABLE` | The constraint is not SOFT |
| `NO_RELAXATION_FOR_TRAVELLER` | The proposal asks nothing of this person |

On failure **nothing is created and nothing is mutated**. There is no partial
acceptance.

`withAcceptedCompromises()` validates too, and an invalid acceptance fails the
whole call rather than being skipped. Plan repair surfaces that as
`INVALID_REQUEST`, carrying the problems.

> This used to be a silent skip. Silence was wrong: a caller could hold an
> unauthorised approval and be shown a plan that quietly disregarded it, with
> nothing anywhere saying so.

### Public and private wording

The domain deliberately produces no group-facing strings containing a
traveller's identity. It carries enough structure for a later presentation layer
to render either form:

| Audience | Wording |
| --- | --- |
| Group | "One traveller would need to stretch their preferred budget." |
| Owner, privately | "This itinerary is SGD 27 above your preferred budget." |

The presentation layer is a later phase. Nothing in Phase 3 renders either.

## 8. Trip-scoped exceptions

**Accepting a compromise never overwrites the stated preference.**

Ama's preference stays "at most 450 SGD" forever. The acceptance records
separately that, for this plan, she agreed to 477. Evaluation runs against a
**derived view** produced fresh on each call and never persisted back.

Three reasons this matters:

1. She can still be shown what she actually prefers, rather than a number she
   reluctantly agreed to once.
2. Withdrawing the compromise is deleting one record, not reconstructing her
   original wishes from a mutated field.
3. A second compromise is measured against her **real** preference, so
   consecutive small stretches cannot quietly ratchet a budget upwards. This is
   asserted by test.

`scope` is `THIS_PLAN` by default; a `THIS_PLAN` acceptance is ignored when
evaluating a different plan.

## 9. Rejection

A proposal carries a content `fingerprint` over its relaxations, order-independent.

Passing rejected fingerprints back suppresses those proposals, so **a traveller
is never asked the identical question twice**. The next eligible candidate is
offered instead. When every option has been refused and nothing else has changed,
the engine returns `ALL_CANDIDATES_REJECTED` rather than cycling.

## 10. Limitations

- Relaxations are proposed, never applied. Acceptance is a separate, explicit act.
- `ARRIVE_BY`, airport and date-window exceptions can be **proposed** but are not
  yet applied as derived values, because no fixture needs them. The engine
  reports the soft violation again rather than pretending the constraint was met.
- Magnitude comparison across unlike units is skipped, not resolved.
- Soft-inconvenience weights are equal and are a product assumption.
- There is no persistence: accepted compromises are passed in by the caller.
