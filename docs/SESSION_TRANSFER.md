# Session Transfer

**Read this first if you have no chat history.** It is the accurate account of
what this project is, what actually works, and what is merely written down.

Where this document and any other disagree about what works,
`IMPLEMENTATION_STATUS.md` wins. Where this document and the code disagree, the
code wins and this document is a bug.

- **Written:** 22 August 2026
- **At commit:** see `git log -1`; this was written at `214c9c9` or later
- **Gate at time of writing:** 941 tests / 46 files, lint, typecheck, build clean

---

## A. Project identity

| | |
| --- | --- |
| Product | Orkestr Travel |
| Event | Alibaba Cloud x Atlas Agentic AI Hackathon 2026 |
| Repository | `ihatecodingaaa/orkestr-travel` |
| Local path | `C:\Users\lucas\Documents\orkestr-travel` |
| Branch | `main` |

**There is a second repository, `orkestr_luc`. Do not touch it.** It is the
preserved Orkestr startup repository, it is out of scope for every hackathon
task, and it must not be inspected, edited, installed, tested or committed to.
If `git rev-parse --show-toplevel` ever shows `orkestr_luc`, stop immediately.

The startup keeps its own validation thesis. This build does not replace it, and
the hackathon technologies used here are not automatically permanent startup
dependencies. See `STARTUP_BOUNDARY.md`.

---

## B. Product thesis

**Not** an AI itinerary generator. Not a flight search engine. Not a chatbot.
Those problems are solved and easy to fake convincingly.

Orkestr coordinates the changing needs of several travellers into one feasible
group journey, asking as few people as few questions as possible.

The question it answers:

> What is the minimum information, group split and compromise required to make
> this journey possible?

The mechanisms, all built and tested:

- **Constraint ownership** — every constraint belongs to exactly one traveller
- **Hard / soft / unknown** — three states, and UNKNOWN is a real answer
- **Travel Waves** — when no single flight carries everyone, split into the
  fewest coherent groups and derive when they can first all be together
- **Compromise** — the smallest relaxation, offered to the person it affects
- **Impact Radius** — how far a change reaches
- **Plan Repair** — repair the smallest area, local-first
- **Decisions Preserved** — a real number with an honest denominator
- **Journey Package** — the whole trip as structured days and items
- **Evidence honesty** — what each source is allowed to establish, in code

---

## C. Phase history

| Phase | Content | State |
| --- | --- | --- |
| 0 | Repository, tooling, domain types | COMPLETE |
| 1 | Deterministic core: feasibility, constraints, money, time | COMPLETE |
| 2 | Travel waves, travel units, reunion anchors | COMPLETE |
| 3 | Compromise, impact radius, plan repair, late join and leave | COMPLETE |
| 4 | Journey, legs, mock flight provider, journey package | COMPLETE |
| 5 | Next.js interface, truth badges, privacy selectors | COMPLETE |
| 6 | Qwen extraction, evidence layer, bounded research | COMPLETE **as code** |
| 6.5 | Live Model Studio verification | **EXTRACTION VERIFIED.** Research still unverified |
| Pre-reset sprint | Offline hardening, kill switch, handoff docs | COMPLETE |
| 7 | Atlas flight provider | NOT STARTED |

### What Phase 6 actually did

Built the whole language-understanding and evidence stack: a validation pipeline
(parse → schema → semantic → safe mapping), the Qwen chat-completions adapter,
the Responses API research adapter with real source capture, URL safety,
evidence claims with authority, user-shared links, and per-subsystem provenance
in the UI.

### What Phase 6.5 did

**Verified live extraction. 38 real calls.**

Three findings, in order:

1. **A 30-second hang that was not a bug.** `qwen3.7-plus` is a hybrid-thinking
   model; sending no `enable_thinking` took its default, and a non-streaming
   request then buffers an entire reasoning phase. Setting it to `false` took
   the smoke test from timeout to SUCCESS in 10.2s.
2. **An over-strict schema.** The first 17-case run passed 8. Eight of the nine
   failures were a missing `tripContext.certainty` discarding valid travellers,
   constraints and relationships. Optional context now degrades field by field
   while the authority boundary is untouched. Second run: **15/17**.
3. **A prompt that said what not to do without saying what to do instead.**
   Told never to guess a currency, the model emitted `currency: ""`. v2 says
   omit the proposal and raise an ambiguity.

**Authority safety and injection containment were 100% in both runs**, including
when the first run was failing half its cases. The boundary held while the
quality was poor, which is the property that matters.

**Research is still unverified.** The Responses API, `web_search` and
`web_extractor` have never been called.

### What the pre-reset sprint did

Found and fixed three defects by audit (see section I), added the external-call
kill switch, the secret gate, the preflight command, and these handoff
documents.

---

## D. Git state

```
branch      main
remote      https://github.com/ihatecodingaaa/orkestr-travel.git
```

Run `git log -15 --oneline` for the current truth. Recent significant commits:

- `feat(safety)` — kill switch, entity-bound claims, secret gate
- `test` — JSON-mode contract asserted on the request body
- `docs` — Phase 6 report
- `fix(research)` — accessibility overclaim by proximity
- `feat(ui)` — mixed provenance, understanding review, evidence screen
- `feat(adapters)` — Model Studio providers and the fixture path
- `feat(domain,core)` — language-understanding and evidence boundaries

---

## E. External services: the truth

| Service | State |
| --- | --- |
| GitHub | **CONFIGURED.** Pushes to `orkestr-travel` are authorised |
| Alibaba Cloud | **CONFIGURED.** Singapore, Model Studio active |
| Model Studio | **CONFIGURED** on the founder's machine. Extraction **LIVE VERIFIED**; research never called |
| Atlas | **NOT CONFIGURED.** No credential, no code, no endpoint contacted |
| Vercel | NONE |
| Neon / Railway / Koyeb | NONE |
| AgentRun / Function Compute | NONE |
| DNS | NONE |
| Database | NONE. No persistence of any kind |
| Qoder | **NO WORK PERFORMED.** `QODER_USAGE.md` records planned tasks only |

**Do not assume a service is configured because adapter code exists for it.**
That inference is exactly backwards, and it is the single most likely way a
fresh session will say something untrue.

Verify for yourself, offline, in one second:

```bash
npm run preflight:model-studio
```

---

## F. Provider modes

`MODEL_STUDIO_MODE` decides whether anything external may be called. Default
`disabled`. See `PROVIDER_MODES.md` for the full matrix.

| Mode | Network | What serves the screens | UI says |
| --- | --- | --- | --- |
| `disabled` (default) | Never | Fixtures | Demo fixture / Local fixture |
| `recorded` | Never | Stored artefacts | (none exist yet) |
| `live` | May call | Model Studio, if credentials present | Qwen live / Model Studio web live |

Three things to internalise:

1. **A credential is not an instruction.** In `disabled` and `recorded` the
   config reader returns before it reads the key at all. No transport exists, so
   no request is constructible.
2. **An unrecognised mode fails closed.** A typo yields `disabled`.
3. **`live` without credentials is a failure, not a downgrade.** It never
   silently becomes fixtures wearing a live label.

**`disabled` and `live` are both exercised.** `live` has made 38 real extraction
calls from the founder's machine. `recorded` still has nothing genuine to serve,
because no live result has yet been sanitised and stored.

---

## G. Invariants — do not break these

These are enforced by tests, several of which read the source and fail the build.

**Deterministic core (`src/core/`)**
- No hard constraint is ever auto-relaxed. Soft relaxes only through the
  compromise engine, with the owner's approval
- `UNKNOWN` never collapses into `SATISFIED`
- Money is compared in integer minor units. No floating point, no FX conversion
- No group size is hard-coded anywhere
- No clock read, no randomness, no network, no model provider named — asserted
  by `phase3Safety.test.ts` reading every file under `src/core`

**Model boundary**
- The model proposes; code decides. Feasibility, waves, repair and commitment
  validity are pure functions and always will be
- A model may never confirm anything. Enforced in three independent places: the
  schema refuses the authority fields, the provider schema does not offer them,
  and the mapper writes `origin: "MODEL_PROPOSED"` / `confirmation: "PROPOSED"`
  as literals
- No response is ever partially applied. One problem fails the whole extraction
- Every proposal carries the words it came from, and a quote absent from the
  supplied text fails semantic validation

**Evidence**
- Community evidence may describe experience and may never establish an
  operational fact. Enforced by a downgrade in `core/research/claims.ts`
- A citation naming a URL no provider tool returned is rejected
- Conflicts are stored symmetrically; neither side can be shown alone
- A claim carries a **subject**, and an access claim may only clear a need for
  the *same* subject. `UNSPECIFIED` matches nothing, in either direction
- Search is not verification. Fixture is not provider

**Interface**
- Provenance is per subsystem. There is no global "live" label, and the function
  that used to produce one was deleted rather than left available
- The flight row reads `Local fixture` with no parameter that can change it
- A private figure never reaches a group surface
- No confidence percentage anywhere. The quote is the explanation

---

## H. The hero demo

A fictional family of seven. Every identity is invented; there is no real
passenger data anywhere in this repository.

| | |
| --- | --- |
| Ama | Hard budget ceiling, 600 SGD |
| Bo | Cannot travel before the 24th; prefers nothing before 09:00 |
| Cai | Needs one checked bag; one stop acceptable |
| Gita | States a step-free access requirement; must travel with Elias |
| Elias | Gita's stated companion |
| Nadia | "Direct is better" — deliberately ambiguous |
| Ryan | Invited, has not replied. Joins late in the demo |

The sequence: no single flight carries everyone → two travel waves → the reunion
boundary → Ryan joins and the plan is repaired locally → a fare rises and the
repair engine decides what it means → the whole journey package, day by day.

Two Phase 6 screens stand apart from that trip, deliberately: `/understand` and
`/research`. There is no persistence, so a live extraction has nowhere to be
kept, and wiring it into the demo trip would mean inventing a session store.
That boundary closes in Phase 8. Say so out loud in a demo; it lands better than
hiding it.

Everything runs offline. `docs/DEMO_SCRIPT.md` has the narration and a
per-beat dependency table.

---

## I. Known gaps, honestly

**The RESEARCH live path is entirely unexercised.** Now the largest risk.
Extraction is verified, which removes the endpoint, credential, region and
model from the list of unknowns -- but the Responses API is a different
endpoint with a different response shape. Plausible first-contact surprises:
whether `web_search` and `web_extractor` are enabled for this workspace, and
the exact shape of `web_search_call.action.sources`. The parser is defensive
about all of it. Defensive is not verified.

**Two evaluation cases still fail, both honestly.** `05-late-join` raises an
ambiguity instead of listing an unreplied traveller; `11-mixed-age-family` had
its whole response refused because the model fabricated quotes for inferred
family relationships. Neither is a safety issue and neither has been tuned away.

**No recording exists.** `recorded` mode has nothing genuine to serve. It becomes
useful after the first successful live call is sanitised and stored.

**Extraction does not reach the demo trip.** No persistence. Phase 8.

**The known-host authority list is small.** Absence means `UNKNOWN`, which is
honest but means many real official pages classify as unrecognised.

**Claim subjects are supplied, not derived.** The research model is not yet
asked to tag which entity each claim is about, so live claims will arrive
`UNSPECIFIED` and will not clear access needs. That is the safe direction, and
worth improving once the live shape is known.

**No route, reservation or operator integration.** Travel time, opening hours,
group capacity and assistance provision are all unknown and labelled as such.

**Three defects were fixed by audit during the pre-reset sprint**, all of the
same family — something true being used to support something it did not
support:

1. A credential alone flipped the app to live
2. Hand-written fixtures were labelled as Model Studio recordings
3. An official fact about a transport operator cleared a garden's access need

---

## J. Next actions, in order

Extraction is done. What remains, in order:

1. One Responses API request; **compare the real shape to the parser** in
   `responsesShape.ts` and fix the adapter if they differ, adding a sanitised
   regression fixture from the real shape
2. One bounded `web_search`; confirm real source URLs are captured from tool
   output rather than from prose
3. One `web_extractor` call, on a URL that search actually returned
4. One user-shared link, including a blocked social page
5. Fix real discrepancies; re-run the deterministic gate
6. Update `IMPLEMENTATION_STATUS.md` — **only for paths actually run.** If
   search works and extraction does not, record that split
7. Atlas setup, then Phase 7

Note: the next substantial development work is expected to be reassigned to
Qoder, which is part of the hackathon judging criteria.

---

## K. Forbidden assumptions

- **Do not assume an external service is configured because adapter code
  exists.** Check with the preflight command
- **Do not mark anything `LIVE VERIFIED` without having run it.** If
  `web_search` works and `web_extractor` fails, record exactly that split
- **Do not guess Atlas endpoints, payloads or capabilities.** Nothing about
  Atlas has been verified. `ATLAS_INTEGRATION.md` holds questions, not answers
- **Do not touch `orkestr_luc`**
- **Do not rewrite the deterministic engines to use a model.** The whole
  defensibility of this project is that feasibility is arithmetic
- **Do not create `.env.local` or invent a credential**
- **Do not record fake "live" results.** A sanitised test fixture is not a
  recorded Model Studio result, and only a real successful call can produce one
- **Do not treat a passing mock as evidence the integration works**

## State at end of Phase 6.7 (22 August 2026)

**Done and verified live:** structured intent extraction, Responses API,
`web_search`, `web_extractor`, the evidence layer, user-shared links, and
research subject binding.

**998 tests across 49 files.** Lint, typecheck, build and secret check clean.

**The subject-binding gap from Phase 6.6 is closed.** Claims bind to journey
entities by an id the caller issues; the model chooses from a bounded list and
can never supply identity itself. Verified live: 4 claims, 2 to the venue, 2 to
the neighbouring station, 0 invented ids.

**Still true, do not re-litigate:**

* Live research is a coin flip (54-76s when it works, >120s otherwise) and this
  is not tunable -- `web_extractor` requires thinking mode. Do not demo it live.
* `enable_thinking` must be `false` for structured extraction and `true` for
  anything using `web_extractor`. They are opposite and both mandatory.
* `web_extractor` cannot be declared without `web_search`.

**Known limitations, honestly:**

* Subject binding was proved by ONE live run. It behaved correctly, including
  the neighbouring-station case, but one run is one run.
* `TOKYO_MULTIGEN` has 4 of 7 claims deliberately unspecified. That is the
  original design exercising the unspecified path -- do not "fix" it.
* The recorded live fixture's subjects were assigned **by hand** from statements
  that name the venue, not returned by the model (it ran under prompt v1). This
  is documented in the fixture itself.

**Next:** Phase 7, Atlas sandbox FlightProvider. Not started.

## State at end of Phase 7 (22 August 2026)

**1067 tests across 51 files.** Lint, typecheck, build and secret check clean.

**Atlas is built but not proven.** The adapter, parser, sandbox guard, kill
switch, lifecycle and engine integration are all done and tested. No authorised
Atlas call has been made, because authorization is a browser step. Two commands
in `EXTERNAL_SETUP.md` unblock it.

**Read `docs/ATLAS_INTEGRATION.md` before touching the adapter.** Five findings
from the real CLI shape the design, and at least three of them look like bugs
until you know why:

* Production is the DEFAULT, and no command reads the current environment.
* A terminal error exits ZERO.
* Search is two commands (`search`, then `offer list --search-id`).
* The official contract forbids `--help`.
* Offers carry `bookable` and `price_status`; a `reference` price cannot be
  verified at all.

**The known gap:** the itinerary field names inside an offer are documented
nowhere and have never been seen. The parser accepts candidate names and fails
closed naming the missing field. **The first authorised search will probably
reject every offer, and that is the design working** -- the rejection reasons say
exactly which names to fix.

**Do not:**
* Add a fallback from Atlas to fixtures. There is deliberately none.
* Add a `production` mode. It is absent from the type on purpose.
* Implement order creation, payment or ticketing. Out of scope, and the
  capability report says UNSUPPORTED for a reason.

**Next:** Phase 8, end-to-end agent repair and hero demo. Not started.

## Atlas live closeout state (22 August 2026)

**1075 tests across 51 files.** All gates green.

**Authorization: DONE.** `DOCTOR_OK`, `AUTHORIZED`, `search_available: true`.

**Sandbox environment setter: LIVE VERIFIED.** The Phase 7 proof was broken --
it required Atlas to echo an environment field that the CLI never sends, so it
could never pass. Replaced with set-then-confirm on `CONFIGURATION_UPDATED`.
Proven live twice, ~1.1-1.3s.

**Atlas Sandbox search: BLOCKED BY ATLAS.** Four searches across two routes and
four dates -- including the official documented `KUL to SIN` example -- all
return `terminal_error` / `INTERNAL_ERROR` with `retryable: false` and empty
data, while the CLI reports fully healthy and authorized. Server-side.

**Do not, when picking this up:**
* Retry the search hoping it clears. Four attempts established the pattern; a
  fifth proves nothing. Check `atlas-flight search ... --json` by hand first.
* Switch to production to "see if it works". Not authorised, not representable.
* Fabricate a recorded Atlas Sandbox fixture. It must come from a real
  successful run.
* Loosen the offer parser. It has never seen a real payload, so there is
  nothing yet to align it to.

**Still unknown:** the real offer payload shape. The parser fails closed naming
the missing field, and the live harness now prints kind, stage and Atlas code, so
the first successful search will diagnose itself.

**Next:** Phase 8, end-to-end agent repair and hero demo. Not started.

## Phase 7 CLOSED (22 August 2026)

**1093 tests across 52 files.** All gates green.

**Everything is live-verified:** authorization, sandbox switch (set-then-confirm,
~1.0-2.0s), search (`FLIGHT_SEARCHED`, HKG-MNL, 2 offers, 2.6-3.5s, 0 rejected),
offer normalisation, and verification (`OFFER_VERIFIED`, unchanged, 2.3-3.6s).

**A recorded Atlas Sandbox fallback exists**, from a real verified run.

### Read this before touching the adapter

* **Sandbox has a bounded test dataset.** HKG-MNL works; SIN-NRT and KUL-SIN
  return `INTERNAL_ERROR`. An earlier conclusion that Sandbox was broken
  server-side was **wrong** and is corrected in `ATLAS_INTEGRATION.md`.
* **Segment times carry no timezone.** `"202609051750"` is a wall clock.
  `localTime.ts` resolves it using a tiny table of airports whose offset is
  fixed all year, and rejects everything else BY NAME. **Never add a
  DST-observing airport to that table** -- it would misplace every flight
  through it for half the year, invisibly.
* **Money arrives as JSON numbers**, and `135.73` is a genuine float artifact in
  the real payload. Never multiply by 100.
* **Search is ONE call.** The offers are in the search response. `offer list` is
  a replay path, not a step.
* **Offers expire in ~15 minutes.** The adapter refuses a past-expiry offer
  without spending a call.

### Do not

* Add a fallback from live Atlas to fixtures. There is deliberately none.
* Add a `production` mode. It is absent from the type on purpose.
* Implement order creation, payment or ticketing. `ticketing_available: true` is
  a capability, not an authorization.
* Re-prove wave isolation with Atlas data. `impact.test.ts` and
  `planRepair.test.ts` already cover it, provider-agnostically.

**Untested by reality:** the price-change and unavailable branches. The real
verification reported an unchanged price and an available offer, and
manufacturing either would mean spamming the provider. Both are proven against
Atlas-shaped fixtures.

**Next:** Phase 8, end-to-end agent repair and hero demo. Not started.

## Phase 8 complete (22 August 2026)

**1136 tests across 54 files.** All gates green.

**What is new:** a bounded agent run. `domain/agentRun.ts`, `core/agent/run.ts`,
`ui/view/agentRun.ts`, `app/demo/agent`.

**What it is not:** a second decision-maker. It coordinates existing engines and
adds a sequence, a budget and an ending. No branch in it decides whether a fare
is acceptable or whether a requirement may bend.

**The two invariants worth protecting:**

* `STEP_LIMIT_REACHED` must never become `COMPLETED`. `SUCCESS_STATUSES` has
  exactly one entry, deliberately written as a list.
* A repair status of `LOCAL_REPAIR_FOUND` is not a valid journey.
  `postconditionsHold` is the separate question, and it can contradict the
  engine.

**One defect found this phase:** `invalidatedDecisionIds` stringified
`DecisionRecord` objects, producing `[object Object]`. Caught by lint, not by a
test, because nothing rendered the list yet. Now reads `.key` and is pinned.

**Demo honesty:** the Tokyo flights are a demo scenario. The Atlas proof is
HKG → MNL because Sandbox serves a bounded route set. The agent screen states
this in writing so the claim survives without narration.

**Next:** Phase 9 — ship. No new features.

## Consumer rebuild, Stage 1 (22 August 2026)

**1,186 tests across 56 files.** All gates green.

**What changed.** Orkestr stopped being a demo with a homepage and became a
product somebody can use. A person can now create their own trip, add people,
record what each of them needs, and watch Group Pulse respond — none of which
was possible before.

**The domain engines were not touched.** This is a UX and product layer on top
of them.

**New:** `domain/consumerTrip.ts`, `core/trips/{store,pulse}.ts`,
`ui/storage/localTripRepository.ts`, `ui/trip/*`, and routes under `/new`,
`/trip/[id]/*`, `/examples/tokyo-family`, `/sources`.

**The old home page moved to `/sources`.** It was honest and it was the wrong
thing to lead with. `/demo/agent` still exists as technical proof.

### Two architectural rules this stage tripped, and honoured

Both were caught by the repository's own guard tests, and both were real:

* `src/core` may not touch `Date`. The trip store now uses `civilDate` helpers.
  It also stopped substituting the Unix epoch for a missing `createdAt` — that
  was exactly the invented value the parser exists to prevent.
* Client components may not import `@/adapters`. Browser storage was mis-filed
  there; `adapters` is for integrations holding credentials. It moved to
  `src/ui/storage`.

### Do not

* Add a Share or Invite button. There is no backend; a button that looks like it
  works and does not is worse than its absence.
* Let trip creation depend on a model call.
* Put provenance back at the top of a page.
* Treat a missing answer as availability.

**Next:** infrastructure — identity, a server-side store, real invite links.
Explicitly not started.

## Consumer rebuild, Stage 2 — the living trip (23 August 2026)

**1,237 tests across 57 files.** All gates green: vitest, `tsc --noEmit`, type-
aware ESLint, production build, and every route serving 200.

**What changed.** Stage 1 made Orkestr usable; it was also passive — you could
create a trip and look at it, and that was all. Stage 2 added the loop:
**discover, contribute, coordinate, plan, decide, adapt**, one verb per screen.

**The domain engines were still not touched.** Stage 2 is a product layer, same
as Stage 1.

**New:** `domain/livingTrip.ts`, `core/trips/{living,commands,mutate,calendar}.ts`,
`ui/trip/{AskOrkestr,Overview,Explore,Plan,GroupScreens,WhatIf,Money}.tsx`,
`app/living.css`, routes `/trip/[id]/{explore,plan,group,inbox,whatif,money,activity}`.

**Renamed and removed:** *People* → **Group**, *Decisions* → **Inbox**, *Updates*
→ **Activity** (out of the primary nav). The `decisions/` and `updates/` routes
were deleted, not aliased.

**Schema v2**, additive. `READABLE_SCHEMA_VERSIONS = [1, 2]`; v1 trips open with
the new fields empty. `parseAutopilot` uses `!== false`, so trips saved before
the settings existed get them on — the behaviour they already had.

### The line every Stage 2 feature holds

* A pasted link is **stored and never fetched**, and the card says so.
* Orkestr **never estimates a price**. Every Money figure was typed by a person.
  An empty box clears an estimate rather than writing zero.
* `setPlanItemStatus` **refuses `BOOKED`**. Nothing in this application books.
* The what-if preview **writes nothing** until somebody applies it, and lists the
  reunion as *kept* when it does not move.
* "Why this fits" says *"1 stated requirement to check against this place"* — it
  never claims a requirement is cleared, because nobody checked the venue.
* Ask Orkestr **refuses unrecognised text by name**. There is no guessing branch,
  and no model call.

### Do not

* Turn Ask Orkestr into a chatbot with a fallback answer. The refusal is the
  feature; wire `recognise` to a model if you like, but it must still produce a
  typed `Intent` and stop at the same gate.
* Add an autopilot switch for relaxing a required constraint or accepting a
  compromise on somebody's behalf. The type deliberately has no field for either.
* Let Explore fetch a URL a person pasted without saying that it did.
* Fill an empty budget with a plausible number.
* Merge non-consecutive activity entries — it would rewrite when things happened.

**Everything from Stage 1's "Do not" list still applies**, including no Share
button and no model call on trip creation.

**Next:** unchanged — infrastructure (identity, a server-side store, real invite
links). Still explicitly not started.

## Consumer rebuild, Stage 2.5 — delight and visual intelligence (23 August 2026)

**1,251 tests across 58 files.** All gates green: secrets, lint, typecheck,
build, and every route serving.

**Presentation only.** No domain engine, provider, persistence or deployment
status changed. No dependency was added.

### What changed

* **Plan** stopped rendering every day at full height. It is a day navigator
  over one focused day, with a real travel timeline. An eighteen-day trip with
  nothing on it was 7,312 pixels of identical empty blocks repeating the same
  three suggestions; it is now about 900.
* **Explore** leads with discovery — a featured place, a group-favourites strip,
  saver faces — and the manual form became a secondary "+ Add your own".
* **Navigation** is one row plus **More**. What-if is promoted onto the Overview.
* **The hero** is drawn from the destination name: map grid, dashed route, one
  of six palettes, deterministic and offline.
* **Zeros** are gone from the stat row unless they are good news.
* **`nextAction`** names the day or the person: "Shape Saturday", "Ask Zen".

### Verified in a real browser, not by reading CSS

Chrome was driven over the DevTools Protocol with no new dependency (Node 24 has
a built-in WebSocket). Screenshots at 1440 / 1024 / 768 / 390 on a seeded local
Seoul trip, an empty Lisbon trip, and the Tokyo example. No horizontal overflow
at any width; all six destinations fit at 390px.

**If you reuse that script: kill `chrome.exe` before each run.** Chrome spawns
child processes, so killing the launcher leaves the browser alive and the next
run ATTACHES to the stale instance and reports the previous build's layout. That
cost an hour of chasing a CSS bug that was already fixed.

### Five defects found by looking at the screen

1. `.timeline li` (demo layer, specificity 0,1,1) beat `.plan-row` and wrapped
   every itinerary title one word per line.
2. `.chip` (demo layer) uppercased every suggested question.
3. `.avatar-stack` was white-on-white for the dark hero and reused on light
   travel-group cards, rendering as faint clipped rings.
4. "About 2 hour here" — the plural was decided from raw minutes, not the
   printed figure.
5. `ul.stack` kept the browser's 40px indent, misaligning decision cards.

**The rule that came out of 1 and 2:** a class name that already exists in
`globals.css` or `product.css` belongs to the demo layer. Pick a different one.

### Do not

* Reintroduce a second navigation row.
* Render every day of a trip at full height.
* Add a remote image, map or weather service for decoration. The hero is drawn
  for a reason.
* Let a suggestion chip say something `recognise` would refuse — a test guards
  this, and it is the whole point of the chips.
* Use colour as the only signal. Day fullness, travel groups and truth states
  each carry a word as well.
* Move truth for the sake of polish. Nothing hides "not verified", "unknown",
  "local example", "recorded", "private" or "tentative".

**Everything from Stage 1 and Stage 2's "Do not" lists still applies.**

**Next:** unchanged — infrastructure (identity, a server-side store, real invite
links). Still explicitly not started.

## Stage 3 local foundation + history sanitisation (23 August 2026)

**1,299 tests across 59 files**, plus 4 browser-bundle tests after the build.
All gates green.

### Part A: the history rewrite happened

Every commit message on `main` was rewritten to drop AI attribution trailers.
73 of 81 commits carried them; 0 do now. Author and committer identity, dates
and every tree SHA are byte-identical -- only messages changed, and the file
tree at HEAD is the same object.

**A recovery bundle exists outside the repository** at
`C:/Users/lucas/Documents/orkestr-travel-pre-attribution-rewrite-20260823-0858.bundle`.
Keep it. It is the only copy of the pre-rewrite history and it is deliberately
not in Git.

Old SHAs in older notes will no longer resolve. `2976703` is now `ce7bee2`.

**The permanent rule:** no commit may carry `Co-authored-by: Claude`,
`Claude-Session:` or an equivalent trailer. Check `git log --format=full`
before pushing.

### Part B: shared trips, up to the infrastructure checkpoint

Everything that does not need a database is built and tested. The PostgreSQL
adapter is written and **has never spoken to a database** -- that label matters
and should not be upgraded without running it.

**Read `docs/INFRASTRUCTURE_CHECKPOINT.md` first.** It says what the founder has
to set up and what to say back ("DATABASE CONFIGURED", no value).

### The one design decision to understand before changing anything

**Privacy is structural.** Owner-only values live in their own table, and
actor-aware builders in `core/shared/views.ts` decide what is *serialised at
all*. Nothing is hidden with CSS or filtered in a component.

If you find yourself writing `if (isOwner) show(...)` in a React component, the
value has already been sent to the wrong browser and the fix is upstream.

### Do not

* Trust a `memberId` from a request. `resolveActor` is the only source of
  identity, and it reads a session cookie.
* Reintroduce "View as" in shared mode. It was honest with one reader; with
  several it is an impersonation endpoint.
* Add a `NEXT_PUBLIC_` variant of any database or session variable. A test
  fails on it, and the consequence is permanent.
* Call it real-time. It polls every seven seconds while visible.
* Call it encrypted. Private values are access-controlled, not encrypted, and
  a database operator can read them.
* Upgrade "IMPLEMENTED" to "LIVE VERIFIED" for the Postgres path until it has
  actually run.
* Let migration claim that somebody confirmed something. Other people's local
  details migrate as drafts, and that is the point of the whole module.

### The database is now real (23 August 2026)

PostgreSQL 17.6. `0001_shared_trips.sql` applied and recorded. **19/19 live
integration tests**, **22/22 two-browser QA**, **20/20 privacy checks against
raw HTTP and RSC payloads**, **9/9 local-trip regression**.

Commands: `npm run db:check` (safe to paste anywhere -- shape facts and a
SQLSTATE, never the value), `npm run db:status`, `npm run db:migrate`,
`npm run test:db`.

The `test:db` suite **fails rather than skips** when `DATABASE_URL` is missing.
That is the lesson from the Stage 2.5 bundle checks, which skipped in exactly
the situation they existed for while still reporting green.

### What shared mode actually covers today

**The Overview, the share screen and the join flow.** Explore, Plan, Group and
Inbox still render from local state -- opening them on a shared trip shows the
device-local product, not the group's. That is the biggest honest gap and the
obvious next piece of work.

Version polling is implemented and tested as a policy; **nothing calls it yet**.
The page prints a version number and does not refresh itself.

**Next:** shared Explore/Plan/Group/Inbox, personal onboarding after joining,
and wiring the sync policy. Deployment is a separate authorisation after that.

## Stage 3.5 — shared experience completed (24 August 2026)

**1,320 unit tests / 61 files · 32 live database tests · 4 browser-bundle
tests.** All gates green.

### The Stage 3 defect is closed

Every trip surface -- Overview, Explore, Plan, Group, Inbox, Money, Activity,
What-if and the personal details page -- now reads the same shared trip. Nothing
falls back to this device.

**Read `docs/SHARED_MODE_ARCHITECTURE.md` before touching any trip screen.** The
short version: screens take a `TripActions`, not a `save` callback; the route
decides the mode on the server; and `buildActorTrip` gives one reader their own
private values back so the existing screens work unchanged.

### Two real defects the acceptance test found

Neither was visible in a type, a lint rule or a unit test.

1. **`buildActorTrip` was never wired in.** A traveller could not see their own
   private requirement -- it was stored correctly in owner-only storage and was
   therefore absent from the group payload, which is right for everybody except
   its owner.
2. **Nothing refreshed after a successful write.** The poll would have found it
   within seven seconds, which is far too long to watch your own click do
   nothing.

A third was found by the new architectural guard: `/people` was still
client-only, and the shared Group screen linked straight into the device-local
product.

### TLS: production always verifies

`rejectUnauthorized: false` is gone. There is no variable, flag or code path
that relaxes verification in production -- `PGSSL_ALLOW_UNVERIFIED` is ignored
there, and a test asserts it for every input.

**The certificate is now configured.** `PGSSLROOTCERT` points at the provider's
root, outside the repository, and `PGSSL_ALLOW_UNVERIFIED` is not set anywhere.
`db:check` reports "verified against PGSSLROOTCERT", the database suite runs the
production trust path, and `next start` serves the whole shared product — it
previously could not connect at all.

### Running the acceptance test

```
PGSSL_ALLOW_UNVERIFIED=true npm run dev
SHOT_OUT=... SEED_JSON="$(cat seed.json)" node scratchpad/e2e.mjs
```

Two isolated Chrome profiles, a real database, 50 checks. It is not in the suite
because it needs a server, a database and a browser.

`next start` works now. The acceptance suite has been run in production mode as
well as development, and the session cookie is `secure=true` there.

### Do not

* Give a screen a `save: (trip) => void` prop again. Two people editing
  different fields would each send a whole trip, and the second would erase the
  first.
* Read `localStorage` from anything under `src/ui/shared`. A guard fails on it.
* Add a member id to a "my" mutation. There is nothing to forge precisely
  because the field does not exist.
* Relax TLS in production. There is deliberately no way to.
* Call it real-time. It polls every seven seconds while visible.

**Next:** production readiness -- database TLS trust, Model Studio key rotation,
hosting, environment variables, domain, deployment.

---

## Handover after the Shared Magic Loop closure

### What is true now

The shared loop is **proven**, not asserted: two isolated browsers, one trip,
one production database, **22/22** — convert, invite, join, save from a link,
merge a second link into one place, build a first draft from shared state, apply
it atomically, read it as the other person, ask as both, pin a generated item,
repair around it, and keep one member's private words entirely away from the
other. A separate **5/5** run proves a stale draft is refused in the browser and
writes nothing.

Gates at handover: **1597 tests / 73 files**, 4 bundle, 39 DB, lint, typecheck
and build clean.

### The two things to know before trusting a green run

1. **Sustained headless runs can trip Vercel's bot mitigation.** It happened in
   this stage: the deployment started returning `403` with
   `X-Vercel-Mitigated: challenge`, which headless Chrome cannot pass. It was
   not evaded — see `SECURITY.md` — and it cleared on its own once the traffic
   stopped, after which everything was re-run against the deployment. If it
   happens again, stop and wait. `scratchpad/sharedloop.mjs` runs against any
   host via `BASE`, because it navigates invite links by path.
2. **Most "failures" in this stage were the test.** Seven of them, listed in
   `MAGIC_LOOP_PRODUCT_SPEC.md` §10.4. Before reporting a defect from a browser
   check, confirm it in the database. Three times the database said the product
   was right.

### Where the next real work is

* ~~A person cannot be added to a trip that is already shared.~~ **Closed.**
  See the Late Joiner handover at the end of this file.
* **48 `browser_session` rows have no membership.** Harmless, and left alone on
  purpose: the only sweep available also takes the 32 that pre-date this work.
  An id-scoped session cleanup would fix that properly.

### Do not

* Weaken `--ids` cleanup into anything that matches by pattern. It deletes
  nothing that was not typed out in full, and that is the property that keeps a
  founder's trip safe from a wildcard.
* Solve a bot challenge to make a test pass.
* Claim the loop works on the deployment until something has run against it.

---

## Handover after the Late Joiner closure

### What is true now

Somebody can join a real shared Orkestr trip after planning has started, without
the group restarting. Verified on the deployment with three isolated browsers:
**29/29**, plus **3/3** for two organiser tabs racing, and clean width QA at 390
and 430.

Gates: **1647 tests / 74 files**, 54 DB, 4 bundle, lint, typecheck, build.

### The two rules not to break

1. **An organiser's note is not the person's answer.** It lives in
   `ConsumerTraveller.draft`, nothing reads it when deciding anything, and it is
   cleared the moment they answer. If you ever find yourself writing it into
   `availableFrom` to "save a step", that is the defect this design exists to
   prevent — the planner cannot tell it from an answer afterwards.
2. **Membership and the payload move together.** `PayloadWrite.addMember` exists
   so they share one transaction. Two calls would leave a member with no
   traveller on a version conflict, and that person's session then resolves to
   nobody.

### Two traps that cost time here

* **A `MemberView` has two string ids.** `id` is membership, `travellerId` is the
  planning model, and passing the wrong one typechecks and renders nothing.
  Components take the member now; keep it that way.
* **`innerText` returns rendered text.** An eyebrow uppercased by CSS does not
  match a case-sensitive regex. Three separate checks in this stage failed on it
  after `MAGIC_LOOP_PRODUCT_SPEC.md` §10.4 had already written it down.

### Where the next real work is

* **Removal has no first-class flow.** `WITHDRAWN` semantics still work and were
  not disturbed, but "someone is dropping out" currently points at What-if
  rather than being a decision you can take from Group. That was deliberate —
  it has plan consequences and What-if is where those are shown — but it is the
  obvious next thing somebody will ask for.
* **`mustTravelWith` is never populated by the consumer product.** The conflict
  detector exists and is tested, but nothing in the consumer flow sets the
  field; only the `/understand` extraction path produces relationships, into a
  different domain type.
* **60 `browser_session` rows have no membership.** Harmless — a session with no
  membership grants access to nothing — and left alone because the only sweep
  available would also take the founder's.
