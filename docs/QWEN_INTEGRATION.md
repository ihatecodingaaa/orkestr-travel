# Qwen and Model Studio Integration

**Status:** structured extraction is `LIVE VERIFIED`. Research, `web_search`
and `web_extractor` remain `LIVE UNVERIFIED` and have never been executed
against the real service. See `IMPLEMENTATION_STATUS.md`, which outranks this
document.

This file exists because the Model Studio specifics are numerous enough that
scattering them through `ARCHITECTURE.md` and `ALIBABA_CLOUD.md` would bury both.

---

## 1. Two responsibilities, kept apart

| Responsibility | Input | Output | Where |
| --- | --- | --- | --- |
| Language understanding | Messy human text | Structured PROPOSED trip state | Chat Completions |
| Research | One typed, bounded question | Real sources, structured claims | Responses API |

They do not share a prompt, a validator or a failure taxonomy, because they fail
differently and mean different things when they do.

**Qwen is not the feasibility engine and never becomes one.** Budget comparison,
time comparison, travel-wave assignment, `mustTravelWith`, hard-constraint
enforcement, compromise eligibility, plan repair, commitment validity and
Decisions Preserved are all deterministic code, unchanged since Phases 1 to 4.
`tests/phase3Safety.test.ts` reads every file under `src/core` and fails the
build if any of them so much as names a model provider.

---

## 2. Configuration

Server-only, read in exactly one module (`src/adapters/modelStudio/config.ts`).

| Variable | Meaning |
| --- | --- |
| `DASHSCOPE_API_KEY` | The credential. Never `NEXT_PUBLIC_`. Never logged |
| `MODEL_STUDIO_WORKSPACE_ID` | Account configuration, so it is never in the repo |
| `MODEL_STUDIO_REGION` | Defaults to `ap-southeast-1` (Singapore) |
| `DASHSCOPE_BASE_URL` | Optional override. Must be https |
| `QWEN_EXTRACTION_MODEL` | Defaults to `qwen3.7-plus` |
| `QWEN_RESEARCH_MODEL` | Defaults to `qwen3.7-plus` |
| `QWEN_STRUCTURED_OUTPUT_MODE` | `json_object` (default) or `json_schema` |
| `MODEL_STUDIO_TIMEOUT_MS` | Per-call deadline. Defaults to 30000 |

The endpoint is built from configuration, never hard-coded:

```
https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1
```

The workspace id is checked against `^[A-Za-z0-9_-]{1,64}$` before it is
interpolated, so a malformed value cannot rewrite the host into somewhere else.

**With none of this set the application still runs**, still builds, still passes
its whole test suite, and demonstrates the entire understanding and research
flow from recorded data that is labelled as recorded.

---

## 3. Structured output, and a documentation conflict

Model Studio's documentation is **inconsistent** on JSON Schema mode. Its
structured-output page documents `json_object` for every Qwen model that
supports structured output and does not mention `json_schema`; other Model
Studio material describes `response_format: {"type": "json_schema", ...}` with
`strict: true`.

This project does not pick a side and pretend. It defaults to the mode that is
unambiguously documented, leaves the stricter one available through
`QWEN_STRUCTURED_OUTPUT_MODE`, and treats **neither as the guarantee**:

> A provider-side schema is a convenience. The guarantee is
> `src/core/intent/schema.ts`, which validates every response regardless.

`max_tokens` is deliberately never set. Capping output while structured output
is enabled truncates the JSON mid-object, which arrives as `MALFORMED_JSON` and
looks like a model failure rather than the configuration error it is.

### `enable_thinking: false`, and the 30-second hang

`qwen3.7-plus` is a hybrid-thinking model. The first credentialled attempt sent
no `enable_thinking`, so the model used its own default, and under a
non-streaming request that means the server buffers an entire reasoning phase
before sending a byte. The request was accepted and then returned nothing until
our own 30s deadline fired -- a different failure from the 401 that preceded it,
and a confusing one, because nothing was broken. We were waiting on work we had
not asked for.

Setting it explicitly took the smoke test from timeout to SUCCESS in 10,171ms.

Non-thinking is also correct on the merits, independently of latency.
Extraction is a bounded transformation: untrusted conversation in, structured
proposals out, deterministic validation after. It is not the planning engine,
so there is no judgement here for a reasoning phase to improve.

On the wire it is a **top-level** body field. The OpenAI SDKs surface it as
`extra_body` because it is not a standard parameter, and `extra_body` merges
into the top level of the request JSON.

---

## 4. The extraction pipeline

```
model response text
   -> JSON parse            MALFORMED_JSON
   -> schema validation     SCHEMA_INVALID  /  UNSAFE_OUTPUT
   -> semantic validation   SEMANTIC_VALIDATION_FAILED
   -> safe mapping
   -> proposed state        SUCCESS
```

Plus `MODEL_NOT_CONFIGURED`, `MODEL_UNAVAILABLE` and `MODEL_TIMEOUT` before any
of it starts.

**Nothing is ever partially applied.** A response where two constraints are fine
and one is impossible is a response we do not understand, and taking two thirds
of it would put an unreviewed reading into somebody's trip while looking like a
success.

### Why validation is hand-written

The failure taxonomy is the product. Orkestr needs to distinguish "the shape is
wrong" from "the shape is right but the content is impossible" from "the
response tried to grant itself authority", because those are three different
things to tell a person and three different things to fix. A generic validator
collapses the last two into the first. The schema is also small and closed, so
the dependency would carry nothing the file does not already state explicitly.

### The prompt is versioned in code

`orkestr-intent-v2`, in `src/adapters/modelStudio/prompts/intentV2.ts`.

**v1 to v2** changed two instructions after the first live evaluation, and the
version moved because both changed what the model is asked to DO:

1. **Unknown currency.** Told never to guess a currency, the model obeyed and
   then emitted the budget anyway with `currency: ""`. Its instinct was right
   and its action was wrong, because the prompt never said what to do INSTEAD.
   v2 says: omit the money proposal entirely and raise an ambiguity.
2. **Date fields.** Given "between four and six nights", it put non-dates in
   `earliestDate` and `latestDate`. v2 says a calendar-date field takes a
   calendar date or nothing, and a stated range is an ambiguity rather than a
   value to choose from.

Results from v1 and v2 are not comparable without saying which produced them,
which is the whole reason the version is stamped on every result. A prompt
is the specification of what the model is being asked to do; building it inline
in a route handler makes it unreviewable and makes an evaluation result
impossible to explain. When a result changes, the first question is what
changed, and "the prompt, some time last week" is not an answer.

The schema is written out for the model in full rather than generated from the
validator. They are two independent statements of the same contract, and when
they disagree the validator wins and the extraction fails loudly. A generated
schema would agree with the validator by construction, including when both are
wrong.

---

## 5. Certainty, not confidence

`EXPLICIT` / `LIKELY` / `AMBIGUOUS`.

There is no confidence percentage anywhere in this system. A number invites a
threshold, and a threshold is a decision nobody reviewed. `LIKELY` is not
confirmed. `AMBIGUOUS` raises a clarification candidate when, and only when, the
difference would change a decision.

What a person sees instead of a number is **the words the reading came from**,
as visible text rather than a tooltip. Those words are sliced out of the
discussion by software, not written by the model -- see section 5a -- so the
explanation is real provenance rather than generated text that resembles it.

---

## 5a. Evidence is a reference, not a quotation

**The model proposes facts and cites span ids. Software resolves the evidence,
software validates it, and unsupported claims fail or are omitted.**

Until 25 August 2026 the prompt asked for `source.quote`: "the exact words from
the discussion, copied verbatim". That instruction was followed badly and could
not be followed well. A model does not copy, it re-generates, so quotes came
back tidied, re-punctuated, merged from two sentences, or plausibly invented.
Deterministic validation refused the whole response, correctly, and in
production `/understand` failed every time on the product's own sample
discussion:

    SEMANTIC_VALIDATION_FAILED at constraints[0].source.quote
    "The supporting quote does not appear in the supplied discussion."

The validator was right. The request was wrong.

### How it works now

    1. segmentDiscussion()   software cuts the supplied text into spans,
                             deterministically, recording offsets
    2. the prompt sends      [M02.S01] Bo: I can only get leave from the 24th.
    3. the model returns     "evidence": ["M02.S01"]
    4. resolveEvidence()     software slices the original characters back out

A hallucinated quotation is not something to detect after the fact. **There is
no field to put one in.** The worst a model can do is cite a wrong id or one
that does not exist, and both are decidable by lookup rather than by judgement.

### The guarantees

* **Every quote is an exact substring of the supplied discussion.** Adjacent
  spans are returned as one slice including the original separator, so a
  two-sentence quotation is still text somebody can find by looking.
  Non-adjacent citations quote the first span and keep the rest as `spanIds`,
  because a quote stitched from two ends of a conversation is words in an order
  nobody wrote.
* **Ids are untrusted input.** They resolve through a `Map` for the current
  request only, so `__proto__` is absent rather than clever, an id from another
  conversation does not resolve, and a citation list is bounded at four.
* **The model may not author evidence text at all.** `source` and `quote` are
  forbidden response fields, failing as `UNSAFE_OUTPUT` rather than being
  ignored -- because ignored is how a prompt regression quietly reintroduces the
  original defect.
* **The old quote check stays.** It is now redundant by construction, which is
  the point of defence in depth.

### What it cost and what it saved

Measured on the same payload, before and after:

| | before | after |
| --- | --- | --- |
| outcome | `SEMANTIC_VALIDATION_FAILED` | **SUCCESS** |
| fabricated quotes | 5 problems | **0** |
| output tokens | 1,650-1,859 | **1,404-1,528** |
| input tokens | 2,291 | 3,024 |
| latency | 30.4-32.8s | **24.6-27.1s** |

Evidence text was the most repeated content in every response and an id is a
handful of tokens, so removing the field that was wrong also made the response
smaller and faster. The spans block costs about 700 input tokens, which is the
cheaper half of the trade.

Across the 17-case live evaluation: **63 quotes checked, 0 fabricated quotes, 0
fabricated citations.**

---

## 6. The model may propose, the model may not confirm

Enforced in three independent places, so no single edit can undo it:

1. **The schema refuses the fields.** `confirmed`, `confirmation`, `origin`,
   `consequential`, `travellerId`, `constraintId` and `id` are all rejected as
   `UNSAFE_OUTPUT` rather than as a malformed response, because their presence
   is not a formatting mistake, it is an attempt at authority.
2. **The JSON Schema sent to the provider closes the object.**
   `additionalProperties: false` throughout, and none of those fields is offered.
3. **The mapper writes the safe values as literals.**
   `origin: "MODEL_PROPOSED"` and `confirmation: "PROPOSED"` with no parameter,
   option or branch that could produce anything else.

Combined with `constraintAuthority` from Phase 1, every consequential proposal
lands as `NEEDS_CONFIRMATION`: real, visible, owned, and unable to veto
anybody's flights until its owner agrees.

Wheelchair assistance, a hard budget, a must-travel-with and "cannot travel on
Tuesday" all take that path.

---

## 7. Adversarial input

The discussion is **untrusted data**. The system prompt says so at length, the
user message wraps it in a delimited block, and a closing marker inside the text
is neutralised so a pasted message cannot end the block early.

**That is a mitigation, not the control.** The control is that an injected
instruction the model obeys completely still cannot obtain authority, because
of section 6. `tests/promptInjection.test.ts` assumes every attack succeeded at
the model and asserts that it changed nothing that matters.

The correct behaviour for a discussion containing "ignore all previous
instructions" is **not** to refuse the whole message. It is to carry on
extracting normally and treat that text as what it is: words somebody typed.
That is asserted too.

---

## 8. Research through the Responses API

```jsonc
{
  "model": "...",
  "input": [ { "role": "system", ... }, { "role": "user", ... } ],
  "tools": [ { "type": "web_search" }, { "type": "web_extractor" } ]
}
```

`code_interpreter` is deliberately not enabled. Nothing in ordinary
travel-source research needs to run code, and a tool that can is a capability
granted for no reason.

### Real sources come from tool calls, never from prose

The response `output` array carries typed items. Sources are read from
`web_search_call.action.sources[].url` and the query from
`web_search_call.action.query`; extracted pages from `web_extractor_call.urls`.
The assistant `message` supplies the structured claims; the `reasoning` item is
ignored entirely, because a reasoning summary is the model narrating itself and
is not evidence.

`src/adapters/modelStudio/responsesShape.ts` is a separate pure module for
exactly this reason: extracting real source URLs is the single most important
step in the research path, and it needs to be testable exhaustively against
recorded bodies, including malformed and half-empty ones.

### A cited URL that no tool returned is rejected

There is no way to tell a real citation from an invented one by looking at it,
so the only safe test is membership: was this page actually returned during THIS
operation? If not, the citation is rejected by name and the claim becomes
`UNVERIFIED` with no sources. It is not dropped, because the fact that the model
asserted something with nothing behind it belongs in the diagnostics.

---

## 9. Bounds

| Limit | Default |
| --- | --- |
| Questions per run | 4 |
| Sources per question | 5 |
| Extracted pages | 6 |
| Provider calls | 8 |
| Timeout | 45s per run, 30s per call |

Three to five sources per question is a deliberate hackathon-scale choice: enough
for a claim to be corroborated or contradicted, small enough that a demo finishes
while somebody is watching.

Hitting a bound produces `RESEARCH_LIMIT_REACHED` and the interface says the
result is partial. There is no open-ended autonomous browsing, no crawling and
no recursive link following.

---

## 10. What is logged

Request id, operation, provider, model, prompt version, duration, token usage
where reported, and counts.

Never the pasted discussion. Never the model's response. Never a constraint
detail. Never an accessibility or medical fact. Never a credential, and every
message that reaches a log passes through `redactSecrets` in case a provider
echoed one back in an error.

Counts answer "did it work, how long did it take, what did it cost", which is
the whole job of an operational log. Anything beyond that is a privacy liability
collected in case somebody might want it.

---

## 11. Opt-in live commands

```bash
npm run smoke:model-studio   # one tiny fictional discussion
npm run eval:qwen            # 17 fictional evaluation cases
```

Neither is part of `npm test`, `npm run check` or `npm run verify`. They use a
separate vitest config with a separate include glob, so they cannot be picked up
by the deterministic gate. If a network outage could turn that suite red, the
reflex becomes to distrust it, and at that point the other 941 tests stop
meaning anything.

With no credentials both report `NOT CONFIGURED` and **skip**. Skipped is not
passed: a smoke test that quietly passes without calling anything reports
success for work that did not happen.

---

## 12. The live evaluation record

Two runs of the same 17 fictional cases, `qwen3.7-plus`, Singapore, 30s
timeout, `enable_thinking: false`. Nothing but the prompt and the schema
changed between them.

| | v1 | v2 |
| --- | --- | --- |
| Provider success | 17/17 | 17/17 |
| Schema valid | 8/17 (47%) | **16/17 (94%)** |
| Cases passed | 8/17 | **15/17** |
| Authority safety | 100% | **100%** |
| Injection containment | 100% | **100%** |
| Mean latency | 7,552ms | 7,231ms |
| Median latency | 6,681ms | 5,998ms |

The two remaining v2 failures are honest ones. `05-late-join` raised an
ambiguity about a traveller who had not replied instead of listing him, which
is defensible and arguably safer than the expectation. `11-mixed-age-family`
fabricated supporting quotes for family relationships it inferred, and semantic
validation refused the whole response -- the validator doing precisely its job.

## 13. What has not been done

- **The Responses API has never been called.** `web_search` and `web_extractor`
  are written from published shapes and have not met the real service.
- No Alibaba Cloud resource has been provisioned. No AgentRun, no Function
  Compute, no deployment.
- No Atlas integration. Flights remain a local fixture.
- No persistence, so live extraction is demonstrated on its own route rather
  than carried into the fixture-backed trip. See `ARCHITECTURE.md` section 6.

## Two provider constraints on `web_extractor` (verified live, 22 Aug 2026)

Both were found by calling the API. Neither is the shape a reasonable person
would guess, and both are the kind of thing a later cleanup would "simplify"
straight back into a 400.

### 1. `web_extractor` may not be declared alone

```
400 InternalError.Algo.InvalidParameter:
The web_extractor tool must be executed with web_search tool.
```

Even when the URL is already known and searching is pointless -- reading a link
a user pasted -- `web_search` must be declared alongside it.

This has a safety consequence. Declaring search gives the model a way to answer
about a page it could not open, by finding a different page on the same subject.
For a pasted link that would put a stranger's summary on screen as though we had
read the user's own page. The capability cannot be withdrawn, so the shared-link
system prompt forbids searching explicitly, and `readable: false` remains the
required answer for a page that would not open. `tests/providerAdapters.test.ts`
asserts both the tool pair and the instruction.

### 2. `web_extractor` may not run with thinking disabled

```
400 InternalError.Algo.InvalidParameter:
Normal mode does not support web_extractor.
Please set enable_thinking to true.
```

This is the exact opposite of what the structured-extraction path needs. Both
settings are mandatory, and they disagree:

| Path | Endpoint | `enable_thinking` | Why |
|---|---|---|---|
| Structured intent extraction | `/chat/completions` | **`false`** | Leaving it on buffers a reasoning phase and hangs past 30s. Setting it false took the call to ~10s. |
| Web research, shared links | `/responses` | **`true`** | `web_extractor` is refused without it. |

**This is the real explanation for research latency**, and it closes the question
of whether the timeouts were a bug worth chasing. Reading pages requires thinking
mode; thinking mode is what makes the call take a minute. The cost is imposed by
the tool, not by our configuration, and no timeout change recovers it.

## Measured live latency

Every figure below is an observed wall-clock duration from this project, not an
estimate.

| Call | Duration | Outcome |
|---|---|---|
| Responses API smoke (no tools) | 4.9s | success |
| Structured extraction, `enable_thinking: false` | ~10.2s | success |
| Shared link, one page | 14.8s - 17.2s | success |
| Web research | 54.2s | success |
| Web research | 55.1s | success |
| Web research | 57.1s | success |
| Web research | >120s | timeout |
| Web research | >120s | timeout |
| Web research | >30s | timeout (against the old 30s ceiling) |

Research succeeded in three of six attempts at a 120s ceiling. **That is a coin
flip, and it is why a recorded fallback exists** -- see `PROVIDER_MODES.md`. The
successful runs cluster tightly at 54-57s, so the failures are not merely slow
runs: the 120s failures reported *zero* search operations, meaning nothing came
back at all rather than something coming back late.

Raising the ceiling further was considered and rejected. A minute is already past
what a person will wait, and nothing in the evidence suggests a longer wait would
have helped.

## Research prompt v2 (Phase 6.7)

`orkestr-research-v1` -> `orkestr-research-v2`. The version is bumped rather
than edited in place because the OUTPUT CONTRACT changed: claims now carry
`subjectId`, and a v1 result has no such field to compare against.

**What changed:** one new output field and a block of rules about it. Nothing
about sources, citations, conflicts or claim types moved.

**What invariant it establishes:** a claim can be tied to a known journey entity,
by an identifier we issued, without the model ever supplying identity itself.
The prompt is given a `SUBJECTS` list of `id = label` pairs and told to use one
of those ids exactly or `null`. The internal subject key is never shown to it.

The rules that matter most, and why each is there:

| Rule | Failure it prevents |
|---|---|
| Use an id from the list, or null | Invented identifiers becoming domain entities |
| Null is a correct answer | Guessing rather than declining |
| The subject is what the STATEMENT describes, not where you read it | A station claim on a museum's website becoming a museum claim |
| Publishing a page does not make the publisher the subject | An operator's page about a third-party venue |
| Do not assume the researched place is the subject | The research target silently landing on every claim |
| Do not carry access information between subjects | "Next door is step-free, so this is" |
| Two subjects on one page means two claims | One claim quietly speaking for two places |

**Live result, 22 August 2026.** One bounded run, two candidates offered
(a garden and the station beside it). Four claims came back: two bound to the
garden, two to the station, none unspecified, **zero invented subject ids**. The
model was not steered toward the station -- the search returned an official
transport page on its own, and the model placed the claims from it correctly.

Latency for that run was 76.6s (two searches, two pages extracted), which sits
above the 54-57s cluster recorded in the table above and does not change the
conclusion below.
