# Failure Modes

**Status:** `IMPLEMENTED` for every mode a built subsystem can reach. Each row
below names where it is handled.

The rule behind every row: **fail honestly**. A polished screen showing a plan
that is not real is worse than a clear statement that something went wrong.

## 1. No feasible plan exists

The group's hard constraints genuinely cannot be satisfied together.

Correct behaviour: say so plainly, name what would have to change and who owns
it, and offer the smallest change as a decision to that person. Never quietly
relax a hard constraint to produce a result.

## 2. Provider unavailable

Atlas is down, times out, or returns an error.

Correct behaviour: state that flight data could not be retrieved. A recorded
fallback may be used for demo reliability **only** if it is labelled
`RECORDED_ATLAS_SANDBOX` and displayed as recorded. Never presented as live.

## 3. Fare changed on verification

Covered in `PLAN_REPAIR.md`. Re-run deterministic feasibility, then either the
commitment stands, one traveller is asked, or the commitment is invalidated.

## 4. Model returns malformed or invalid output

**Implemented in Phase 6.** Six distinct outcomes, each with its own sentence on
screen, because they are different things to tell a person:

| Outcome | What happened |
| --- | --- |
| `MODEL_NOT_CONFIGURED` | No credential, so nothing was sent anywhere |
| `MODEL_UNAVAILABLE` | The provider could not be reached |
| `MODEL_TIMEOUT` | The deadline passed and the request was aborted |
| `MALFORMED_JSON` | Not JSON at all |
| `SCHEMA_INVALID` | Valid JSON of the wrong shape |
| `SEMANTIC_VALIDATION_FAILED` | Right shape, impossible content |
| `UNSAFE_OUTPUT` | The response tried to confirm something |

**Nothing is ever partially applied.** A response where two constraints are fine
and one is impossible fails entirely, because the valid half could be the wrong
half. The screen says so in those words.

The failure detail never carries the response text, which may contain the
pasted discussion. A test asserts it.

## 5. Model proposes a wrong constraint

**Implemented in Phase 6.** This is why consequential constraints require owner
confirmation. The proposal is shown with the quote it came from, as visible text
rather than a tooltip, so the owner can see the basis and correct it. Semantic
validation rejects a quote that does not appear in the supplied discussion, so
the explanation is real provenance rather than generated text resembling it.

## 4b. An optional context field is unreadable

**Implemented after a live evaluation found the cost of getting this wrong.**

Not every field deserves the same blast radius. A malformed CONSTRAINT fails
the whole extraction, because a half-read constraint could veto somebody's
flights. A malformed DESTINATION LABEL should not, because it binds nothing.

The first live run failed eight of nine cases on a missing
`tripContext.certainty`, discarding valid travellers, constraints and
relationships each time. Optional context now degrades field by field:
unreadable means omitted, with an `ExtractionWarning` recording the path, the
reason and the effect.

Three properties keep that safe. Degradation only ever REMOVES, so nothing can
be defaulted or inferred into existence. A missing certainty stays missing
rather than being upgraded. And an authority field inside trip context is
still fatal, because a model putting `confirmed` there is attempting authority
rather than fumbling decoration.

## 5b. Somebody pastes an instruction into the discussion

**Implemented in Phase 6.** The correct behaviour is NOT to refuse the message.
It is to carry on reading it as what it is, which is words somebody typed.

The prompt says the discussion is data, and the block delimiter is neutralised
against early closure. Both are mitigations. The control is that an injected
instruction the model obeys completely still cannot obtain authority: the schema
refuses the fields that carry it, and the mapper writes the safe values as
literals. 13 tests assume the attack succeeded and assert nothing changed.

## 5c. A model cites a source it never visited

**Implemented in Phase 6.** There is no way to tell a real citation from an
invented one by inspection, so citations are resolved against the sources the
provider's tools actually returned. A URL that appears only in generated prose
is rejected by name, the claim becomes `UNVERIFIED`, and the research screen
lists what was rejected rather than hiding it.

## 5d. A page a user shared cannot be read

**Implemented in Phase 6.** A normal outcome, not an error. The state is
`EXTRACTION_UNAVAILABLE`, the screen says "we could not read this page
automatically" and that nothing about its contents has been guessed, and then
asks the person why they saved it. There is deliberately no fallback that
derives an interest from the hostname: a guess would be indistinguishable, on
screen, from something the page actually said.

## 5e. Research is unbounded, or hits its bound

**Implemented in Phase 6.** Four questions, five sources each, six extracted
pages, eight provider calls, 45 seconds. Hitting a bound produces
`RESEARCH_LIMIT_REACHED` and the screen says the result is partial rather than
presenting it as a complete answer.

## 6. Traveller never responds

Correct behaviour: the plan proceeds using what is known, and their state stays
`INVITED` or `TENTATIVE`. Their unanswered questions are visible. The group is
not blocked indefinitely by one silent person, and nothing is invented on their
behalf.

## 7. Late joiner cannot fit any wave

**Implemented in Phase 3.** Preserve every existing wave, then widen outward: add
a new wave if a flight suits them, propose a compromise if only a soft preference
blocks them, or report the hard blockers and stop. The core never picks which
hard requirement should be weakened.

## 7b. A change makes the agreed plan invalid

Correct behaviour: report `COMMITMENT_INVALID` and repair the smallest area that
needs it. Never re-optimise the whole trip because a change created an
opportunity elsewhere: **validity is not re-optimisation**, and a plan that still
works is kept.

## 7c. A repaired plan looks fine but nothing checked the seats

**This is the most likely honest-looking lie in the current system.** Phase 3 has
no provider, so a traveller fitting a flight is `LOGICALLY_COMPATIBLE` and
nothing more. Every changed wave is flagged for reverification, and the wording
is asserted by test to avoid the words verified and confirmed.

## 7d. A package looks complete but the group cannot get home

**Closed in Phase 4.** A journey is an ordered list of legs and the return leg is
planned like any other. A leg with no plan makes the package `INCOMPLETE`, and a
traveller left off a leg's waves is a validation error rather than a silent gap.

## 7e. A group activity is scheduled before half the group has landed

The composer DROPS a whole-group activity that would fall before the reunion
boundary rather than scheduling it for whoever happens to be there. The hero
fixture contains one deliberately, and a test asserts it never appears.

## 7f. The interface makes something look more certain than it is

**The most likely honest-looking failure in a demo.** A green tick beside a
suggestion, or an assistance request styled like a confirmation, would overstate
what the system knows while looking completely normal.

Mitigation is structural rather than editorial: domain state maps to appearance
in ONE module, the positive tone is unreachable for anything a local fixture
produces, and tests assert that a suggestion is styled differently from a
booking and that assistance never reaches a verified tone.

## 8. Assistance need cannot be confirmed

Correct behaviour: status stays `NEEDS_CONFIRMATION` with a handoff task. Never
upgraded to verified on the strength of community evidence.

## 9. Evidence conflicts

**Implemented in Phase 6.** `CONFLICTING`, recorded symmetrically so neither side
can be displayed alone, and rendered as "Sources disagree" with both statements
and an explicit line saying Orkestr has not picked one. Not averaged, not
silently resolved in favour of the more convenient one, and never relied on
without confirmation.

## 10. Stale data

Correct behaviour: labelled `STALE` and re-verified before it is relied on.

## 11. Clock and time zone errors

The most likely silent defect in this product. Mitigation is structural: dates,
instants with offsets, and local times of day are distinct types, and engines
receive timestamps as inputs rather than reading the clock.

## 12. Demo-specific risk

The highest-risk moment is a live provider call during a presentation.

Mitigation is a recorded structured result that is **labelled as recorded**,
plus a rehearsed narration of what the label means. See `DEMO_SCRIPT.md`.

**There is no automatic fallback from live to recorded.** If a live call fails,
it fails, and the screen says which failure it was. A fixture answer appearing
under a live label would be the single most damaging thing this product could
do in front of an audience, because nobody watching could tell.

## 13. One label covering subsystems with different provenance

**The most likely honest-looking lie in the Phase 6 build.** A live language
model and a fixture flight list under one "live" badge would be true of the
part somebody is looking at and false of the part they are about to trust.

Mitigation is structural: provenance is per subsystem, the flight row is fixed
at `Local fixture` with no parameter that could change it, every row is rendered
every time including the unflattering ones, and the Phase 5 global banner was
**deleted** rather than left available. Twelve tests iterate every combination
of subsystem modes and assert the flight and capacity rows never move.

## Live failures observed in Phase 6.6

| Symptom | Real cause | How to tell |
|---|---|---|
| Research times out at 120s | Provider returned nothing at all | `searchOperations: 0` in diagnostics. A slow run still reports operations. |
| Shared link "unavailable" in ~130ms | Our request was malformed; a 400 came back | Duration. A real failed extraction takes 10-20s. Check `rejectionReason`. |
| Claims have 0 sources but outcome is SUCCESS | Extracted pages were never collected as sources | `rejectedCitations` names pages the extractor definitely read. |
| `web_extractor` 400s | Declared without `web_search`, or with `enable_thinking: false` | The 400 message states which. Both are documented in `QWEN_INTEGRATION.md`. |

**The general rule this phase established: check the duration before believing
the failure.** Three separate defects in this phase produced honest-looking
failure states that were actually our own bugs, and in every case the wall-clock
time gave it away before the error message did.
