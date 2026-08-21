# Evidence Model

**Status:** `IMPLEMENTED` (`src/domain/evidence.ts`, `src/core/research/`).
The rules below are enforced by code and asserted by 35 tests in
`tests/evidenceLayer.test.ts`.

## 1. Purpose

Record where every claim came from, and enforce what each kind of source is
allowed to establish.

## 2. Two axes, deliberately kept apart

Phase 6 splits what used to be one field, because collapsing them is how an
arbitrary webpage becomes "official".

**Authority** is what a source IS, and therefore what it may establish:

| `SourceAuthority` | May establish |
| --- | --- |
| `OFFICIAL_WEB` | Operational facts: access, opening times, capacity, policy |
| `PROVIDER` | Facts from a booking or travel provider's own system |
| `COMMUNITY` | Experience only. Never an operational fact |
| `EDITORIAL` | Published context |
| `UNKNOWN` | Nothing. Not recognised, and not upgraded by anything the page says about itself |

**Ingestion origin** is how it reached us, which is a different question:

| `EvidenceIngestionOrigin` | Meaning |
| --- | --- |
| `WEB_SEARCH` | Returned by a live provider web search |
| `USER_SHARED` | A public link a person handed us themselves |
| `RECORDED_WEB` | A sanitised structured result from a real earlier call, replayed. Never live. **None exists yet** |
| `LOCAL_FIXTURE` | Hand-written in this repository. Never real research |

Neither is derived from the other. Authority comes from deterministic known-host
configuration in `src/core/research/sources.ts`; a host that is not in it stays
`UNKNOWN`, which is a real answer and not a soft yes.

Suffix matching is on a label boundary, so `notreddit.com` cannot inherit
`reddit.com`'s classification and `fake-tokyometro.jp` cannot inherit an
operator's.

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

Ten reviews saying "step-free, no problem" do not make a venue accessible. They
are ten people's experience, which is worth reading and worth showing, and they
are not a statement from the operator.

**This is code, not prompt wording.** `assembleClaims` downgrades any
`OPERATIONAL_FACT` with no official or provider source behind it to a
`COMMUNITY_SIGNAL` that needs confirmation. The model does not choose the claim
type; the authorities of the supporting sources do. A model marking a Reddit
thread `OPERATIONAL_FACT` changes nothing.

## 4. Claims and sources are separate objects

A `ResearchSource` is a page that was actually retrieved. An `EvidenceClaim` is
a statement, with the ids of the sources behind it.

Identity of a source **is** its normalised URL, so the same page found twice is
one source. Two results differing only by `utm_source` counting as two would let
"several sources agree" mean one source cited twice, which is exactly the false
corroboration this layer exists to prevent.

## 5. A citation to a page nobody retrieved is rejected

A model asked to cite its sources will sometimes produce a plausible URL it
never visited. There is no way to tell a real citation from an invented one by
looking at it, so the only safe test is membership: was this page actually
returned by a search or an extraction during THIS operation?

If not, the citation is recorded in `rejectedCitations` and the claim becomes
`UNVERIFIED` with no sources. It is not silently dropped: the fact that the
model asserted something with nothing behind it belongs in the record, and the
research screen prints the rejected URLs.

## 6. Evidence states

Qualitative on purpose. The system knows how many distinct sources said
something and whether they agreed, and that is genuinely all it knows.

| `EvidenceState` | Meaning |
| --- | --- |
| `MULTI_SOURCE_SUPPORTED` | Two or more independent sources agree |
| `SINGLE_SOURCE` | Exactly one source. Real, but thin |
| `MIXED` | Broad agreement, differing detail |
| `CONFLICTING` | Sources genuinely disagree |
| `STALE` | Supported, but every supporting source is past the freshness window |
| `UNVERIFIED` | Stated with no source we could verify |
| `EXTRACTION_FAILED` | A page was selected but could not be read |

A percentage here would be invented precision, so there is not one.

## 7. Conflicts are kept as conflicts

Two sources disagreeing is information. Averaging them, or picking the more
convenient one, destroys the only signal the user had that the answer is
uncertain.

Conflicts are stored **symmetrically**, whether or not the model reported them
in both directions, so neither side of a disagreement can be displayed alone.
The interface renders it as "Sources disagree", shows both statements, and says
that Orkestr has not picked one. Anything conflicting needs confirmation before
it can be relied on.

## 8. Freshness

Computed from real dates, never asserted. `UNDATED` is a real value for a source
with no discoverable publication date: it means we do not know, which on a page
about opening hours is different from fresh and different from stale.

A claim takes the **weakest** freshness across its supporting sources, not the
average. A claim supported by one fresh page and one eight-year-old page is only
as current as the evidence you would have to fall back on.

## 9. Community summaries

`sourcesConsidered` is counted from the ledger, never taken from the model. If
two community sources exist, it says two. "Based on 47 reviews" when four pages
were read would be the easiest and most damaging lie this product could tell, so
the number is not the model's to report.

Disagreements are shown, not averaged away.

## 10. What each part of the system can actually produce

| Source | What it produces |
| --- | --- |
| Flight offers | `LOCAL_FIXTURE`, always. The builder hard-codes it with no override |
| Journey activities in `/demo` | `LOCAL_FIXTURE`, cited to the fixture |
| Research with no credential | `LOCAL_FIXTURE`, written by hand in this repository |
| Research with a credential | `WEB_SEARCH`, from live Model Studio search and extraction |
| A link a user pastes | `USER_SHARED` |

The journey package validator refuses an evidence reference that does not
resolve, and refuses a `VERIFIED` item that cites no evidence at all.
Verified-on-nothing is the exact shape of an honest-looking lie.

## 11. Recorded results are never shown as live

A recorded structured result carries real source URLs, real titles and real
publication dates. It does **not** carry copied webpage text: no scraped article
body is stored in this repository, and a test asserts every recorded claim is a
single sentence rather than a page body.

**Nothing has ever been recorded from Model Studio's RESEARCH path**, because
the Responses API, `web_search` and `web_extractor` have never been called. Live
extraction has been verified; research has not. The fixture research provider
therefore reports `LOCAL_FIXTURE`, which is what it is: hand-written data in
this repository.

An earlier version labelled it `RECORDED_WEB`, which the interface renders as
"Recorded Model Studio result". Calling hand-written data a recording of a
service that has never been called is exactly the kind of small overclaim that
collapses under one question from a judge.

`RECORDED_WEB` remains in the model as a declared future state. It becomes
reachable when a genuine call has been made and sanitised, and not before. See
`PROVIDER_MODES.md`.

## 12. Traceability

Every factual reason shown in a "why Orkestr suggested this" explanation carries
either a real claim id or the name of a deterministic check that produced it.
`SuggestionReason` is a union of exactly those two shapes, so a third kind of
reason cannot be constructed and therefore cannot be displayed.

## What a live run actually produced (22 Aug 2026)

One question -- step-free access at Hamarikyu Gardens, for a group of seven with
a stated requirement -- run against real `web_search` and `web_extractor`.

```
outcome: SUCCESS          durationMs: 54210
searchOperations: 1       pagesExtracted: 3
sourcesCollected: 6       rejectedCitations: 0
claims: 12                invariants: PASS
```

Of the 12 claims: 5 `OPERATIONAL_FACT`, 7 `COMMUNITY_SIGNAL`, 2 `CONFLICTING`,
and **every one resolved to a source the provider had actually returned**. Every
operational fact had an `OFFICIAL_WEB` source behind it; no community page was
allowed to state one.

### The defect this run exposed, and the run before it hid

An earlier live run reported the same `SUCCESS` and looked fine. It was not:
every claim carried **zero** sources, and three citations were rejected --
including two genuinely official pages the extractor had just read.

The cause was that extracted pages were counted in the spend ledger but never
passed to `collectSources`. Only search *hits* became sources. So when the model
cited the page it had actually opened and read, that citation resolved against a
set that did not contain it, and was rejected as fabricated. **The invariant was
working perfectly and rejecting the truth.**

The fix collects extracted URLs first, ahead of search hits, so the pages the
extractor opened are in the set before anything cites them. The ordering is
deliberate and visible in the output: extracted sources carry no `rank` and no
`searchQuery`, because they did not come from a search.

Two lessons worth keeping:

* A green `SUCCESS` line is not evidence that the evidence layer worked. The
  count of claims with zero sources is the number that would have caught this,
  and it is now printed by the harness.
* An integrity check that rejects real provenance is worse than useless, because
  it looks like diligence. The rejection log is the place that defect surfaced,
  and rejected-citation counts should be read as a signal about *our* pipeline
  before they are read as a signal about the model.

### Entity binding, live

Claims returned by the live model arrive with **no subject**, so they are stored
as `UNSPECIFIED`. `UNSPECIFIED` matches nothing, which means none of them can
clear a stated accessibility requirement.

That is the fail-safe behaving exactly as designed, and it is also a real
limitation: the research prompt does not yet ask the model to name what each
claim is about, so useful official facts cannot currently be bound to the venue
they describe. The recorded fixture binds subjects explicitly, which is why the
replay path can demonstrate the matching that the live path cannot yet reach.
Closing this means adding a subject field to the research payload -- a change to
the prompt and the schema, not to the safety rule.
