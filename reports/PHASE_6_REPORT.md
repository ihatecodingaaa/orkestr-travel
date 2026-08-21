# Phase 6 Report

**Alibaba Model Studio / Qwen structured intent extraction, the Orkestr Evidence
Layer, user-shared links, bounded live web research, and evidence-backed
Journey Package suggestions.**

Date: 21 August 2026
Repository: `C:\Users\lucas\Documents\orkestr-travel`
Remote: `https://github.com/ihatecodingaaa/orkestr-travel.git`

---

## 1. Executive status

Phase 6 is complete as code, and **unverified against the live service**.

Everything specified was built: structured extraction with a real validation
boundary, the evidence layer with authority and ingestion origin kept apart,
user-shared links with a full SSRF refusal, bounded research through the
Responses API with real source capture, evidence-backed suggestions gated by
deterministic checks, and per-subsystem provenance replacing the single Phase 5
banner.

**No live call to Alibaba Cloud Model Studio has ever been made from this
repository.** There is no `DASHSCOPE_API_KEY` in this environment. Every Model
Studio path is written from the published API shapes and unit-tested against
recorded response bodies through an injectable transport. The opt-in commands
that would verify it were run and reported `NOT CONFIGURED`, skipping rather
than passing.

That is why `IMPLEMENTATION_STATUS.md` gained a new status value. `IMPLEMENTED`
in that document means "verified by running it", and the adapters have not been
run, so they are marked `UNVERIFIED`. Marking them `IMPLEMENTED` would have been
exactly the optimism that document forbids itself.

Gates: **860 tests across 43 files, all passing.** Lint, typecheck and the
production build clean. Baseline was 498; see section 28 for the four that were
touched and why.

---

## 2. Model Studio setup

**None performed.** No account created, no credential issued, no resource
provisioned, no endpoint contacted.

What was built is the client. Configuration is read in exactly one module and
the endpoint is constructed rather than hard-coded:

```
https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1
```

Region defaults to `ap-southeast-1` (Singapore). The workspace id is validated
against `^[A-Za-z0-9_-]{1,64}$` before interpolation, so a malformed value
cannot rewrite the host. `DASHSCOPE_BASE_URL` overrides the whole thing and must
be https. No personal workspace id is committed.

`NOT CONFIGURED` is a first-class state, not an error path. With an empty
`.env.local` the application runs, builds, passes its whole suite, and
demonstrates both new flows from recorded data that it labels as recorded.

---

## 3. Models actually used

**None, live.** Configured defaults are `qwen3.7-plus` for both extraction and
research, environment-overridable via `QWEN_EXTRACTION_MODEL` and
`QWEN_RESEARCH_MODEL`.

Nothing is architected around one model name, and there is no automatic
escalation to a more expensive model. If a larger model is evaluated later that
is an evaluation result, not a silent fallback.

---

## 4. Structured extraction architecture

Two API modes, chosen per task:

| Task | Endpoint |
| --- | --- |
| Extraction | `/compatible-mode/v1/chat/completions`, structured output, `temperature: 0` |
| Research | `/compatible-mode/v1/responses`, `web_search` + `web_extractor` |

`max_tokens` is deliberately never set: capping output under structured output
truncates the JSON mid-object, which arrives as `MALFORMED_JSON` and looks like a
model failure rather than the configuration error it is.

Model output lands in `ProposedTripIntent`, which is **not** a domain type. It
has no `confirmed` field, no `origin` field and no permanent identifiers, so a
model has nothing to write those into however it is prompted. Person references
are temporary (`P1`, `P2`), and code maps them to identities.

Layering:

```
src/domain/      intent.ts, extraction.ts, evidence.ts, research.ts   types
src/core/        intent/, research/                                   pure
src/adapters/    modelStudio/, fixture/, registry, diagnostics        network
src/ui/          provenance, understanding, research view models      render
```

`src/adapters/` is deliberately outside `src/core/`, which the purity guard
forbids from naming a model provider, reading a clock, using randomness or
making a request.

**Two dependency decisions, and why.** Plain `fetch` behind a one-method
interface rather than the OpenAI SDK, so every adapter is testable against
recorded bodies with no network and no SDK internals, and so no vendor type
escapes the boundary. Hand-written validation rather than a schema library,
because the failure taxonomy is the product and a generic validator collapses
`SEMANTIC_VALIDATION_FAILED` and `UNSAFE_OUTPUT` into `SCHEMA_INVALID`.

Dependencies added: **`server-only`** (a two-line Vercel marker package). That
is the whole list.

---

## 5. Prompt version

`orkestr-intent-v1`, in `src/adapters/modelStudio/prompts/intentV1.ts`.
Research uses `orkestr-research-v1`.

Both are versioned in code, not built inline in a route. A prompt is the
specification of what the model is being asked to do; when an evaluation result
changes, the first question is what changed, and "the prompt, some time last
week" is not an answer.

The JSON schema is written out for the model in full rather than generated from
the validator. They are two independent statements of the same contract, and
when they disagree the validator wins and the extraction fails loudly. A
generated schema would agree with the validator by construction, including when
both are wrong.

---

## 6. Validation boundary

```
model response text
   -> JSON parse            MALFORMED_JSON
   -> schema validation     SCHEMA_INVALID  /  UNSAFE_OUTPUT
   -> semantic validation   SEMANTIC_VALIDATION_FAILED
   -> safe mapping
   -> proposed state        SUCCESS
```

Plus `MODEL_NOT_CONFIGURED`, `MODEL_UNAVAILABLE` and `MODEL_TIMEOUT`.

**Nothing is ever partially applied.** A response where two constraints are fine
and one is impossible fails entirely, and the screen says so in those words: the
valid half could be the wrong half.

Semantic validation is the layer worth naming. It rejects an unknown person
reference, a self-referential travel relationship, a backwards date range, a
duplicate reference, and — most importantly — **a quote that does not appear in
the supplied discussion**. Every consequential proposal is shown to its owner
with the words it came from; if the quote could be invented, that explanation
would be theatre.

---

## 7. Consequential-constraint behaviour

Enforced in three independent places, so no single edit undoes it:

1. The schema refuses `confirmed`, `confirmation`, `confirmedAt`, `origin`,
   `authority`, `binding`, `consequential`, `travellerId`, `ownerTravellerId`,
   `constraintId` and `id` — as `UNSAFE_OUTPUT`, not as a malformed response,
   because their presence is an attempt at authority rather than a typo.
2. The JSON Schema sent to the provider closes every object
   (`additionalProperties: false`) and offers none of those fields.
3. The mapper writes `origin: "MODEL_PROPOSED"` and `confirmation: "PROPOSED"`
   as literals, with no parameter, option or branch reaching them.

Combined with `constraintAuthority` from Phase 1, every consequential proposal
lands `NEEDS_CONFIRMATION`. Everything a model reads is consequential except a
narrative note.

Extracted assistance needs additionally arrive `SENSITIVE`,
`confirmedByOwner: false`, `operationalStatus: UNKNOWN`, and extracted
travellers arrive `INVITED` with no age band — being mentioned in a group chat
is not agreeing to come, and text written about somebody is not that person
supplying their age.

---

## 8. Ambiguity handling

`EXPLICIT` / `LIKELY` / `AMBIGUOUS`. No confidence percentage anywhere: a number
invites a threshold, and a threshold is a decision nobody reviewed. A test
asserts the review screen renders no `%` and no "confidence".

The prompt instructs the model to raise an ambiguity **only** when the answer
would change a decision, and to record both readings when the discussion
contradicts itself. The hero fixture raises exactly two: whether "direct is
better" is a requirement or a preference, and whether Ryan is coming.

---

## 9. Prompt-injection handling

The system prompt states at length that the discussion is data; the user message
wraps it in a delimited block whose closing marker is neutralised so a pasted
message cannot end the block early.

**Both are mitigations. Neither is the control.** The control is section 7:
`tests/promptInjection.test.ts` assumes every attack succeeded completely at the
model and asserts it changed nothing. A response that marks a budget confirmed
is refused as `UNSAFE_OUTPUT`. A response that quietly extracts an absurd budget
passes the schema and still cannot bind. A response that fabricates a quote to
look authoritative fails semantic validation.

Also tested: fake system prompts, pasted JSON, HTML, URLs, quoted instructions
and a closing delimiter.

And the case that matters for usability: a discussion containing "ignore all
previous instructions" must **not** be refused wholesale. The correct behaviour
is to carry on extracting and treat that text as what it is, which is words
somebody typed. That is asserted.

---

## 10. Evaluation cases

**17 cases** in `src/eval/cases.ts`, every discussion invented, every name from
the fictional cast. A test asserts no case introduces an unknown speaker.

Covered: clear group, ambiguous direct preference, hard budget, stretchable
budget, late join, flexible duration, multiple date windows, `mustTravelWith`,
`preferTravelWith`, explicit step-free need, mixed-age family, conflicting
statements, tentative traveller, prompt injection, unnamed travellers, no
currency stated, and nothing to extract.

The scorer checks **structure, never prose**. A model that words a constraint
differently has not failed at anything. Two safety properties run on every case
regardless of what it declares: no constraint may arrive confirmed, and no
constraint may arrive with a non-model origin.

The two negatives matter most: case 11 fails a reading that infers a mobility
need from "my mother who is 78", and case 17 fails a reading that invents a
requirement from football chatter.

---

## 11. Live evaluation results

**Not run. No credential.**

```
$ npm run smoke:model-studio
[configuration] status: NOT_CONFIGURED
                missing: DASHSCOPE_API_KEY, MODEL_STUDIO_WORKSPACE_ID
[result]        status: NOT CONFIGURED
                detail: No call was made. The tests below are skipped, not passed.
Tests  1 passed | 1 skipped (2)

$ npm run eval:qwen
[configuration] status: NOT_CONFIGURED   cases: 17
[result]        detail: No call was made. 17 cases were skipped, not passed.
Tests  1 passed | 17 skipped (18)
```

Skipped, not passed. A smoke test that quietly passes without calling anything
reports success for work that did not happen.

Both use `vitest.live.config.ts`, a separate config with include glob
`evals/**/*.live.ts`, so neither can be picked up by `npm test`, `npm run check`
or `npm run verify`. If a network outage could turn the deterministic suite red,
the reflex becomes to distrust the suite.

---

## 12. Research architecture

Research is not "look up Tokyo". It is a typed `ResearchQuestion` with a kind, a
destination, group context, a source preference, a hard source ceiling and a
stated purpose. Nine kinds, each with a consumer.

Responses API request:

```jsonc
{ "model": "...", "input": [...], "tools": [{"type":"web_search"},{"type":"web_extractor"}] }
```

`code_interpreter` is not enabled: nothing in travel-source research needs to run
code, and a tool that can is a capability granted for no reason.

---

## 13. Web search, extraction, and actual-source capture

`src/adapters/modelStudio/responsesShape.ts` reads the `output` array:

| Item | What is taken |
| --- | --- |
| `web_search_call` | `action.sources[].url`, `action.query`, rank, status |
| `web_extractor_call` | `urls[]`, status |
| `message` | `content[].text` — the structured claims |
| `reasoning` | **Ignored.** The model narrating itself is not evidence |

It is a separate pure module precisely because this is the most important step in
the research path, and it needs testing against malformed and half-empty bodies.
Every field is read defensively: a provider that renames something produces fewer
sources, never a crash and never a fabricated one.

Every captured URL then goes through the safety check and deduplication before
becoming a `ResearchSource`.

---

## 14. Evidence model

Two axes kept apart, because collapsing them is how a webpage becomes "official":

* **`SourceAuthority`** — `OFFICIAL_WEB`, `PROVIDER`, `COMMUNITY`, `EDITORIAL`,
  `UNKNOWN`. From deterministic known-host configuration, never from the page's
  own claim, with label-boundary suffix matching so `notreddit.com` inherits
  nothing.
* **`EvidenceIngestionOrigin`** — `WEB_SEARCH`, `USER_SHARED`, `RECORDED_WEB`,
  `LOCAL_FIXTURE`.

`EvidenceState`: `MULTI_SOURCE_SUPPORTED`, `SINGLE_SOURCE`, `MIXED`,
`CONFLICTING`, `STALE`, `UNVERIFIED`, `EXTRACTION_FAILED`. Qualitative on
purpose.

Source identity **is** the normalised URL, so a page found twice is one source.
Two results differing only by `utm_source` counting as two would let "several
sources agree" mean one source cited twice.

Freshness is computed from real dates. `UNDATED` is a real value, and a claim
takes the **weakest** freshness across its sources, not the average.

---

## 15. Official versus community

`assembleClaims` downgrades any `OPERATIONAL_FACT` with no official or provider
source behind it to a `COMMUNITY_SIGNAL` that needs confirmation. The model does
not choose the claim type; the authorities of the supporting sources do.

The recorded research fixture deliberately over-claims a working lift as an
operational fact with only a Reddit source, and a test asserts it is downgraded
exactly as a live response would be. A fixture that could not fail would test
nothing.

---

## 16. Conflicting evidence

Recorded **symmetrically**, whether or not the model reported both directions,
so neither side can be displayed alone. Rendered as "Sources disagree" with both
statements and an explicit line saying Orkestr has not picked one. Anything
conflicting needs confirmation.

The fixture contains a real disagreement about whether a pier route has a
working lift, and the route test asserts both claims come back `CONFLICTING`.

---

## 17. Rejected citations

A citation naming a URL no tool returned is rejected by name. There is no way to
tell a real citation from an invented one by inspection, so membership in the
retrieved set is the only safe test.

The claim becomes `UNVERIFIED` with no sources rather than being dropped: that
the model asserted something with nothing behind it belongs in the record, and
the research screen prints the rejected URLs.

---

## 18. User-shared links

Public HTTP/HTTPS only, read through the provider's `web_extractor`. **No TikTok,
Instagram or Reddit API. No scraper. No browser automation.** No platform
credential exists anywhere in the project.

States: `EXTRACTED`, `EXTRACTION_UNAVAILABLE`, `URL_REJECTED`, `NOT_CONFIGURED`.

A blocked social page is a **normal outcome**. The screen says "we could not read
this page automatically" and that nothing about its contents has been guessed,
then asks "why did you save it?". There is deliberately no fallback that derives
an interest from the hostname: a guess would be indistinguishable, on screen,
from something the page actually said.

A successful read produces at most an `INFERRED` interest. Sharing a night-market
video is not asking for a night market.

Bounded at three links per submission, so one paste cannot spend a budget.

---

## 19. URL security

`src/core/research/url.ts`, checked **before any request is made**, because a
rejection after the request has gone out is not a rejection. 47 tests.

Refused: non-web schemes (`file:`, `data:`, `javascript:`, `ftp:`, `ws:`);
localhost in four spellings; `127.0.0.0/8` and `0.0.0.0/8`; `10/8`, `172.16/12`,
`192.168/16`; carrier-grade NAT `100.64/10`; link-local `169.254/16` including
the cloud metadata address by name; IPv6 `::1`, `fe80::/10`, `fc00::/7` and
IPv4-mapped loopback; internal hostnames and suffixes; bare hostnames with no
dot; embedded credentials; and any port outside 80/443/8080/8443.

A refused URL is never rendered as a clickable link.

---

## 20. Age-aware curation

Age bands are passed to research as a **count**, immediately followed by "use
this only to check that everybody could take part, do not infer anybody's
interests from it". Stated interests appear **before** the age mix and are
labelled "these matter most".

The research prompt separately forbids inferring interests from age, inferring an
accessibility need from age, and guessing the age of the people who wrote the
sources. The extraction prompt forbids the same. `tests/prompts.test.ts` asserts
all of it including the ordering, and that the constructed instruction contains
no stereotype token.

The mapper never assigns an age band from extracted text at all.

---

## 21. Accessibility research

Operational access claims require official or provider provenance. Community
sources may inform experience, walking difficulty, crowding and practical tips,
and may never establish access.

A suggestion for a group with a stated movement need is **not refused** when no
official page exists — refusing every venue without one would quietly exclude
the person with the need from the trip. It carries `ACCESSIBILITY_UNVERIFIED`
and an explicit task to check with the venue. What never happens is the claim
being shown as settled.

**A defect found and fixed during self-review** is recorded in section 27.

---

## 22. Pre-flight, post-flight, meals, and journey enrichment

Question kinds exist for `AIRPORT_PRE_FLIGHT`, `POST_FLIGHT`,
`LARGE_GROUP_DINING` and `DIETARY_FIT`, and the deterministic checks that gate
any suggestion enforce the boundaries Phase 4 established:

* A whole-group item before the reunion is **refused**, and refused equally when
  the reunion is not established at all — an unknown boundary is not a satisfied
  one.
* A suggestion naming a traveller not on the journey is refused.
* A suggestion outside the journey window is refused.
* A suggestion citing a claim not in the ledger is refused.
* A suggestion with no traceable reason is refused.

Every accepted suggestion carries `TRAVEL_TIME_UNVERIFIED`, added by the checks
rather than trusted from the model: whether travel time is known is a fact about
what data exists. Reservation availability stays `RESERVATION_AVAILABILITY_UNKNOWN`
because no reservation provider exists. No immigration or customs timing is
produced anywhere.

Suggestions enter as `SUGGESTED`. There is no path that promotes anything to
`VERIFIED` because a model liked it.

---

## 23. Why this fits you

`SuggestionReason` is a union of exactly two shapes: `EVIDENCE` with a real claim
id, or `DETERMINISTIC_CHECK` with the name of the check. There is no third kind,
so an untraceable reason cannot be constructed and therefore cannot be displayed.

The screen labels each line "From a source" or "Checked by Orkestr", and lists
what is still unknown beneath rather than omitting it.

---

## 24. Mixed provenance, and live/recorded/fixture states

The Phase 5 banner is gone, and `dataSourceBanner` with it — deleted, not left
unused, because a ready-made global banner sitting in the codebase is an
invitation to reintroduce exactly the claim this phase forbids.

```
GROUP UNDERSTANDING    Qwen - live  |  Demo fixture extraction  |  Not configured  |  Failed
DESTINATION RESEARCH   Model Studio web - live  |  Recorded  |  Local fixture  |  Not configured  |  Failed
FLIGHT INVENTORY       Local fixture        (always; no parameter changes it)
PROVIDER CAPACITY      Not connected
ASSISTANCE             Traveller confirmed, provider pending
```

Sixteen tests iterate every combination of subsystem modes and assert the flight
and capacity rows never move, that every row renders every time including the
unflattering ones, and that the word "Atlas" appears nowhere.

There is **no silent fallback**. The registry returns a provider and its mode
together, so a screen cannot take one without the other. A live call that fails
fails; it does not become a fixture under a live label.

---

## 25. Timeouts, errors and recorded fallback

`AbortController`, not `Promise.race`: racing leaves the request running with its
socket open. Default 30s per call, 45s per research run, both configurable and
neither unbounded.

Every failure state has its own sentence on screen — seven for extraction, nine
for research, four for shared links — because they are different things to tell a
person. Network failure messages are replaced rather than passed through, since
the underlying error carries the endpoint URL and therefore the workspace.

Recorded results carry structure only: source URLs, titles, publication dates,
claims. **No scraped page body is stored in this repository**, and a test asserts
every recorded claim is a single sentence rather than an article. They report
`RECORDED_WEB` and are rendered distinctly from live.

---

## 26. Cost observability

Token usage is recorded where the provider reports it, and shown on the screen
that triggered the call: provider, model, prompt version, duration, input and
output tokens. Research additionally reports searches, sources collected, pages
read and provider calls.

Counts are omitted entirely when the provider reported none, rather than recorded
as zero — zero reads as "this cost nothing", which is a different statement from
"the provider did not tell us".

**No dollar estimate is displayed.** No pricing is configured.

Bounds: 4 questions, 5 sources per question, 6 extracted pages, 8 provider calls.
Hitting one produces `RESEARCH_LIMIT_REACHED` and the screen says the result is
partial.

---

## 27. Self-review: defects found and fixed

**1. An official claim could clear an unrelated accessibility need.**
The research action passed every official operational fact as an
`accessClaimIds` entry, which `checkSuggestion` reads as "claims asserting this
venue meets this need". An officially-sourced fact that the metro publishes
step-free route information was therefore clearing a step-free requirement for a
garden teahouse, stripping `ACCESSIBILITY_UNVERIFIED` and the confirmation task
off a suggestion nobody had checked.

Both halves were true — the source was official and the fact was correct — which
is what made it hard to see. An overclaim assembled entirely out of true
statements is the worst kind. Fixed: nothing in the current pipeline can identify
a claim as being about access for a specific venue, so the honest value is an
empty list. Found by writing the end-to-end route test.

**2. Certainty was paired to constraints by list position.**
The understanding view model paired `mapped.constraints[i]` with
`intent.constraints[i]`, correct only while the mapper appended in one particular
order. Showing "stated outright" beside a requirement nobody stated is precisely
the failure that screen exists to prevent. Fixed: certainty now travels on the
constraint id via `MappedIntent.certaintyByConstraintId`.

**3. A dead global banner left available for reuse.**
After the provenance board replaced it, `dataSourceBanner` and
`CURRENT_DATA_SOURCE` were unreferenced by any component. Deleted rather than
kept, with a note in `truth.ts` explaining where provenance went and why one
global label can no longer be true.

**4. `IMPLEMENTATION_STATUS.md` named the wrong repository.**
It claimed the only outward-facing actions were pushes to `orkestr_luc`. They
were pushes to `orkestr-travel`. Corrected.

Actively hunted and **not** found: any credential in the repository or in git
history; any `NEXT_PUBLIC_` secret; raw prompt or response logging; model output
trusted without validation; a model-created confirmed constraint; partial
application of invalid JSON; feasibility or wave logic in the AI layer; a
generated citation URL entering the record; a community source upgraded to
official; a user-shared source automatically trusted; a source conflict erased; a
hallucinated social extraction; live research silently replaced by fixture; one
global LIVE state; unbounded research; scraped content committed; a fixed
group-size assumption; an age stereotype; reviewer age inference.

---

## 28. Test results

```
Test Files  43 passed (43)
Tests      860 passed (860)
```

Baseline was 498. Exactly four baseline tests were touched, all of them because
Phase 6 deliberately deleted the thing they described:

* `ui/truth.test.ts` 12 -> 10. The two removed tested `dataSourceBanner` and
  `CURRENT_DATA_SOURCE`, which no longer exist.
* `ui/components.test.tsx` 16 -> 18. Two rewritten for the subsystem board that
  replaced the banner, two added for what that board must now say.

**Every other baseline test passes unmodified.**

Phase 6 added 362, none touching a network:

| Suite | Tests |
| --- | --- |
| `intentSchema.test.ts` | 35 |
| `intentMapping.test.ts` | 31 |
| `promptInjection.test.ts` | 13 |
| `urlSafety.test.ts` | 47 |
| `evidenceLayer.test.ts` | 35 |
| `suggestionChecks.test.ts` | 20 |
| `providerAdapters.test.ts` | 52 |
| `serverActions.test.ts` | 12 |
| `serverBoundary.test.ts` | 11 |
| `routeActions.test.ts` | 17 |
| `prompts.test.ts` | 25 |
| `evalCases.test.ts` | 11 |
| `ui/provenance.test.ts` | 16 |
| `ui/phase6Components.test.tsx` | 30 |
| `phase3Safety.test.ts` (extended) | +7 |
| `components.test.tsx` (extended) | +2 |

---

## 29. Quality gates

| Gate | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm test` | 860 passed |
| `npm run build` | green, 9 routes |
| `npm run check` | clean |
| `npm run verify` | clean |
| `npm run smoke:model-studio` | **NOT CONFIGURED — skipped, not passed** |
| `npm run eval:qwen` | **NOT CONFIGURED — 17 cases skipped, not passed** |

Live results are reported separately above, as section 11, so a provider failure
can never be mistaken for a unit-test failure.

---

## 30. Documentation

Every Markdown file inspected. **14 updated, 1 added.**

Updated: `README.md`, `IMPLEMENTATION_STATUS.md`, `ARCHITECTURE.md`,
`ALIBABA_CLOUD.md`, `EVIDENCE_MODEL.md`, `SOCIAL_RESEARCH.md`,
`ACCESSIBILITY.md`, `SECURITY.md`, `TESTING.md`, `FAILURE_MODES.md`,
`DEMO_SCRIPT.md`, `GROUP_STATE.md`, `CONSTRAINT_ENGINE.md`,
`JOURNEY_PACKAGE.md`, `PRODUCT_SPEC.md`, `HACKATHON_MASTER_PLAN.md`,
`STARTUP_BOUNDARY.md`.

Added: `QWEN_INTEGRATION.md`. It earns its place: the Model Studio specifics are
numerous enough that scattering them across `ARCHITECTURE.md` and
`ALIBABA_CLOUD.md` would bury both.

Unchanged because unaffected: `TRAVEL_WAVES.md`, `COMPROMISE_ENGINE.md`,
`PLAN_REPAIR.md`, `ATLAS_INTEGRATION.md`, `QODER_USAGE.md`.

A documentation conflict is recorded rather than resolved by guessing: Model
Studio's own pages disagree about whether `json_schema` response format exists.
The build defaults to the unambiguously documented `json_object` and treats
neither as the guarantee.

No document says "AI researches TikTok directly". `SOCIAL_RESEARCH.md` states in
as many words that none may.

---

## 31. Git

Six commits on `main`:

```
5e9e82c fix(research): no official claim may clear an accessibility need by proximity
060619b docs: record Phase 6, and say plainly that no live call was made
becd6bd test: 345 deterministic tests, and live evaluation kept out of the gate
e5464e7 feat(ui): mixed provenance, the understanding review and the evidence screen
fa9d685 feat(adapters): Model Studio providers, and the fixture path that survives without them
c685667 feat(domain,core): the language-understanding and evidence boundaries
```

`.env.local` does not exist and is gitignored at `.gitignore:15`. The staged diff
was scanned for key-shaped literals before every commit. No API key, no raw user
prompt, no scraped page, no sensitive response is committed.

---

## 32. Infrastructure touched

| Provider | State |
| --- | --- |
| Model Studio **local API access** | **NO — no credential exists, no call made** |
| Vercel | NONE |
| Railway | NONE |
| Neon | NONE |
| Koyeb | NONE |
| AgentRun | NONE |
| Function Compute | NONE |
| Atlas | NONE |
| ATRIP | NONE |
| DNS | NONE |
| Database | NONE |

The only outward-facing actions were git pushes to `orkestr-travel`, and the
documentation web fetches used to establish the Model Studio API shapes.

---

## 33. Known risks and remaining gaps

**The live path is unexercised.** This is the largest risk in the phase. The
adapters are written from published API shapes and have never met the service.
Plausible surprises on first contact: the workspace-domain host form, whether
`web_search` and `web_extractor` are enabled for a given workspace, the exact
`sources` element shape, and whether `qwen3.7-plus` is available in
`ap-southeast-1`. The reader is defensive about all of it, but defensive is not
verified.

**Extraction does not reach the demo trip.** Deliberate: no persistence, and a
session store would be fake persistence pretending to be real state. Closes in
Phase 8.

**The known-host authority list is small.** Being absent means `UNKNOWN`, which
is honest but means many real official pages classify as unrecognised until the
list grows.

**The research action builds one suggestion.** The pipeline supports many; the
demo route composes a single candidate. Not a limitation of the core.

**No route provider, no reservation provider, no operator contact.** Travel time,
opening hours, group capacity and assistance provision all remain unknown and
are labelled as such.

---

## 34. Recommended Phase 7

**Implement the real Atlas sandbox `FlightProvider`.**

The `FlightProvider` contract, `OfferEvidenceState` and `MockFlightProvider`
already exist and are tested, so the shape is proven. Phase 7 should replace the
mock behind that boundary with a sandbox client, keep `RECORDED_ATLAS_SANDBOX`
distinct from `ATLAS_SANDBOX_SEARCH` distinct from `ATLAS_VERIFIED`, and flip the
provenance board's `FLIGHT INVENTORY` row from `Local fixture` to something
earned.

It needs real Atlas documentation and sandbox credentials. It also needs the same
discipline applied here: no test may call the sandbox, the recorded path must run
the same pipeline as the live one, and the row must never say live when it is
recorded.

**Phase 7 has not been started.**
