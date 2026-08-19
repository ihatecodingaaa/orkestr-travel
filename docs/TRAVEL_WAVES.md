# Travel Waves

**Status:** `PLANNED` (Phase 2). **The wave engine does not exist.**

Types exist in `src/domain/travelWave.ts` and `src/domain/reunion.ts`, and Phase 1
built the feasibility engine the wave engine will call. But no grouping code has
been written, and nothing in the system currently splits a group.

Because of that, the two travel-together constraint kinds
(`MUST_TRAVEL_WITH`, `PREFER_TRAVEL_WITH`) are reported by the feasibility engine
as `DEFERRED_TO_LATER_PHASE` rather than being checked. That is deliberate: the
gap stays visible instead of being silently treated as satisfied.

## 1. The idea

A large group does not necessarily need one flight.

When no single departure satisfies everyone's hard requirements, most systems
report failure. Orkestr instead asks: what is the smallest number of coherent
subgroups that makes this trip possible, and when does everyone meet?

```
Wave A    Tuesday 25 Aug    5 travellers
Wave B    Wednesday 26 Aug  6 travellers
                |
                v
Reunion anchor  Wednesday 26 Aug, 18:30, hotel check-in
```

The destination journey remains one shared trip. Only the getting-there splits.

## 2. Why this is not just "book two flights"

Three things make it a real engine rather than a convenience:

1. **Hard relationships must survive the split.** A traveller who requires a
   caregiver may never be placed in a different wave from that caregiver.
2. **The reunion is a planning constraint, not a note.** Before the anchor, the
   whole group does not exist, so no group activity may be scheduled there.
3. **Fragmentation has a cost.** Splitting into five waves to save a little money
   is a worse answer than two waves, and the engine has to know that.

## 3. Priority order

The engine optimises in this strict order. A lower priority never overrides a
higher one.

1. Satisfy every hard constraint.
2. Preserve every `mustTravelWith` relationship.
3. Minimise the number of waves.
4. Minimise the spread between the first and last arrival.
5. Minimise cost.
6. Minimise soft inconvenience.

## 4. Approach

Deliberately simple. For hackathon-sized groups (roughly 4 to 15 travellers) an
explicit deterministic search over candidate groupings, pruned by hard
constraints, is fast enough and readable. **No optimisation library will be
introduced unless a real measured need appears.** An unreadable solver that
nobody can explain to a judge is worse than a slightly slower loop.

The algorithm will be documented here in full when it is written, including its
complexity and its pruning rules.

## 5. Ranking

Each candidate split is returned as a `WavePlan` carrying `waveCount`,
`arrivalSpreadMinutes`, `softInconvenienceScore` and a written `rationale`. The
scores are stored on the object so that "why this split?" is answered from data,
not from a model's recollection.

## 6. Reunion anchors

A `ReunionAnchor` records the time, place, participants, purpose and status of
the moment the group becomes whole. It must sit at or after the last
participating wave's arrival, plus realistic buffers. If a wave changes so that
the anchor no longer follows every arrival, the anchor becomes `INVALIDATED`
rather than being silently moved.

## 7. Single-wave trips

A trip where everyone travels together is simply a `WavePlan` with one wave.
There is no separate code path, so the common case and the split case cannot
drift apart.

## 8. Test obligations

Groups that fit in one wave; groups that cannot; a `mustTravelWith` pair that
would otherwise be split; a `preferTravelWith` pair that legitimately is split;
absurd fragmentation being rejected; arrival spread computed across time zones;
and an anchor invalidated by a wave change.
