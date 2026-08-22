# Judging rubric audit

Rubric weights as published: **Innovation 30% · Feasibility 30% · Qoder 20% ·
Demo 20%.**

This is a ruthless self-assessment, not a pitch. Where we are weak it says so,
because a judge who catches one inflated claim discounts everything else.

---

## Innovation — 30%

**What judges likely want:** something that is not another itinerary generator.

**Our three strongest claims**, in order. Do not dilute these by listing twenty
features.

**1. Travel Waves.** When no single flight satisfies everybody, the group is
split by *confirmed availability*, deterministically. Most tools either fail or
quietly drop the inconvenient person. Visible at `/demo/waves`.

**2. Least-change repair, with what-did-not-change stated.** Planning asks "what
is the best trip?"; repair asks "what is the smallest valid change to the trip
we already have?". Orkestr answers the second and reports the decisions it
preserved. **Most planners cannot make this claim at all**, because they rebuilt
everything and have nothing to compare against. Visible at `/demo/agent`.

**3. Private compromise with owner authority.** A soft budget breach asks the one
person whose constraint it is — not the group, not the organiser. An approval
from the wrong person is a hard failure, not a silent skip.

**Weakness.** "Group travel planner" sounds crowded, and a judge may pattern-match
to a voting app in the first ten seconds.

**Mitigation.** The first fifteen seconds of the video say *"this is not a search
problem, it's a coordination problem"*, and the hero page opens with the
repair-not-regenerate claim rather than an itinerary.

**Do not claim:** that nobody has ever split a group before, or that this is a
new category. It is a sharper answer to an existing problem.

---

## Feasibility — 30%

**What judges likely want:** evidence it actually runs, not a prototype held
together for the video.

**Evidence:**

| Claim | Proof |
|---|---|
| Live Qwen structured extraction | Verified; 17-case evaluation corpus |
| Live Responses API, `web_search`, `web_extractor` | Verified with recorded latencies |
| Entity-bound research claims | Verified live: an official page about a *station* did not clear a *garden's* requirement |
| Live Atlas sandbox search | `FLIGHT_SEARCHED`, 2 offers, ~2.6s |
| Live Atlas offer verification | `OFFER_VERIFIED`, unchanged, ~2.3s |
| Exact money | Integer minor units; a real float artifact in the live payload is pinned by test |
| Bounded agent | One counting site; `STEP_LIMIT_REACHED` never becomes success |
| False-success protection | Postconditions can contradict the engine's own status |
| Test suite | **1,150 tests across 55 files**, no network required |
| Runs with zero credentials | Verified against a production build; every route 200 |

**Weakness.** No booking, no payment, no persistence, no deployment yet.

**Mitigation.** Say plainly that the differentiator is coordination and repair,
and that a booking flow would add risk and prove nothing about the hard part.
The absence is a scope decision, not a gap in capability.

**Do not claim:** production Atlas, real purchasable fares, or that the Tokyo
route came from a provider.

---

## Qoder — 20%

**Qoder was used, once, for a genuine final hardening pass on 22 August 2026.**
Full record in `docs/QODER_USAGE.md`.

An earlier version of this audit said the evidence was absent and flagged it as
the largest scoring exposure in the submission. That was true when written and
is no longer true.

**What it actually did:**

* Spec-driven Quest generated the hardening specification; the audit continued
  in Agent mode.
* Ran on BYOK Alibaba Cloud Model Studio (Qwen-3.7-Max) after native Qoder
  credits were exhausted.
* Exercised `/demo/agent` in a running browser.
* Found **two confirmed defects** that every prior review had missed, including
  one that put a false claim on the hero screen: a failed repair reported every
  travel group as affected.
* Added regression tests and produced commit `e716ccd`.

**Honest qualification.** One of its two fixes was incomplete and was corrected
on independent review (`bc45132`) — it removed a false "everything changed" and
left behind a false "nothing happened". That is worth stating plainly: it makes
the record credible, and finding a real defect on a live screen is the harder
half of the work.

**Strength:** a real defect, in real running code, found by a tool doing what it
claims to do — not a decorative integration.

**Weakness:** one pass, late in the project. Qoder did not shape the
architecture, and the record says so.

**Do not claim:** built with Qoder, a majority built with Qoder, any percentage,
or that Qoder produced architecture predating this pass.

---

## Demo — 20%

**What judges likely want:** to understand the product without narration, and to
believe what they are shown.

**Strengths:**

* Problem stated in the first fifteen seconds, before any interface.
* The climax is a *refusal to rebuild*, not a generated itinerary.
* Real numbers on screen: 10 of 10 decisions kept, 0 rebuilds, 5 of 7 steps.
* Deterministic — the demo is byte-identical between runs, verified by test, and
  needs no network. A retake produces the same numbers.
* Every screen labels its own data source. No global "LIVE" badge.

**Weaknesses and how each is handled:**

| Weakness | Handling |
|---|---|
| Tokyo is not Atlas-backed | Stated on the page itself, and in narration. One sentence. |
| Research is recorded | Labelled `RECORDED MODEL STUDIO`; the latency reason is documented |
| The fare change is simulated | Labelled a demo scenario; the real verification returned *unchanged* |
| No deployed URL yet | Founder decision; see `DEPLOYMENT_PLAN.md` |

**Do not:** animate "searching live" over a recording, call sandbox fares real,
or claim a live price change occurred.

---

## Overall

| Criterion | Confidence | Note |
|---|---|---|
| Innovation 30% | **Strong** | Three sharp claims, all demonstrable |
| Feasibility 30% | **Strong** | Two live integrations, 1,150 tests, runs with no credentials |
| Qoder 20% | **Modest but real** | One genuine pass; found two live defects |
| Demo 20% | **Strong** | Deterministic, honest, climaxes on the differentiator |

Qoder is no longer a zero. It is a modest, truthful entry: one pass, two real
defects found on a running screen, one of which needed correcting afterwards.
That is a far better story than a fabricated one, and it is the only story the
git history supports.
