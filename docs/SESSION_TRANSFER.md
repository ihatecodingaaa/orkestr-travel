# Session Transfer

**Read this first if you have no chat history.** It is the accurate account of
what this project is, what actually works, and what is merely written down.

Where this document and any other disagree about what works,
`IMPLEMENTATION_STATUS.md` wins. Where this document and the code disagree, the
code wins and this document is a bug.

- **Written:** 22 August 2026
- **At commit:** see `git log -1`; this was written at `214c9c9` or later
- **Gate at time of writing:** 885 tests / 44 files, lint, typecheck, build clean

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
| 6.5 | Live Model Studio verification | **BLOCKED — no credential** |
| Pre-reset sprint | Offline hardening, kill switch, handoff docs | COMPLETE |
| 7 | Atlas flight provider | NOT STARTED |

### What Phase 6 actually did

Built the whole language-understanding and evidence stack: a validation pipeline
(parse → schema → semantic → safe mapping), the Qwen chat-completions adapter,
the Responses API research adapter with real source capture, URL safety,
evidence claims with authority, user-shared links, and per-subsystem provenance
in the UI.

### What Phase 6.5 could not do

**Make a single live call.** No Model Studio credential has ever existed in this
environment. Every adapter is written from published API shapes and tested
against recorded response bodies through an injectable transport. None has met
the real service.

Phase 6.5 did verify offline: the JSON-mode requirement is satisfied in both
request messages, the region and endpoint shape are correct, and the config
boundary is sound.

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
| Alibaba Cloud | **NOT CONFIGURED.** No account action has been taken |
| Model Studio | **NOT CONFIGURED.** No key, no workspace, **no call ever made** |
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

**Only `disabled` is genuinely exercised today**, because no credential exists
and no recording exists.

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

**The live path is entirely unexercised.** The largest risk in the project.
Plausible first-contact surprises: the workspace-domain host form, whether
`web_search` and `web_extractor` are enabled for a given workspace, the exact
shape of `web_search_call.action.sources`, and whether `qwen3.7-plus` is
available in `ap-southeast-1`. The parser is defensive about all of it.
Defensive is not verified.

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

1. **Founder sets up Alibaba Cloud / Model Studio** and creates `.env.local`.
   See `EXTERNAL_SETUP.md`. Nobody else can do this step.
2. `npm run preflight:model-studio` — confirm it reports ready
3. `npm run smoke:model-studio` — one tiny fictional request
4. Adversarial smoke: confirm an injected instruction still cannot gain authority
5. `npm run eval:qwen` — 17 fictional cases
6. One Responses API request; **compare the real shape to the parser** and fix
   the adapter if they differ, adding a sanitised regression fixture
7. One bounded `web_search`; confirm real source URLs are captured
8. One `web_extractor` call on a URL that search returned
9. Fix real discrepancies; re-run the deterministic gate
10. Update `IMPLEMENTATION_STATUS.md` — **only for paths actually run**
11. Atlas setup, then Phase 7

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
