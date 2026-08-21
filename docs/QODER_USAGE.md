# Qoder Usage

**Status:** `PLANNED` (Phase 11). **No Qoder activity has occurred. Every table
below is an empty template.**

Qoder is a real judging criterion. Claude is the main engineering agent, and
Qoder must perform genuine, recorded work. Fabricating Qoder activity would be
both dishonest and trivially detectable, so this document records only what has
actually happened, which so far is nothing.

## How to use this document

When a Qoder stage is performed, fill in the corresponding table with what was
actually run, what it found, and what changed as a result. Leave a stage empty
until it happens. An empty stage is an accurate record; a plausible-looking
invented one is not.

---

## Stage 1: Architecture and specification review

| Field | Record |
| --- | --- |
| Date performed | *not yet performed* |
| Scope reviewed | |
| Findings | |
| Actions taken | |
| Evidence location | |

---

## Stage 2: Adversarial engine test generation

Target: the deterministic engines, especially boundary values in the feasibility
and wave engines.

| Field | Record |
| --- | --- |
| Date performed | *not yet performed* |
| Engines targeted | |
| Tests generated | |
| Defects found | |
| Tests retained in the repository | |

---

## Stage 3: Browser and end-to-end QA

| Field | Record |
| --- | --- |
| Date performed | *not yet performed* |
| Flows tested | |
| Defects found | |
| Fixes applied | |

---

## Stage 4: Final repository code review

| Field | Record |
| --- | --- |
| Date performed | *not yet performed* |
| Scope | |
| Findings by severity | |
| Actions taken | |

---

## PLANNED WORK

**Nothing below has been performed.** These are task briefs, written so that
whoever runs a Qoder stage knows what it is for and what would count as a
result. Each stays here, unfilled, until it actually happens; the tables above
are where completed work is recorded.

Deliberately no date, no finding and no accepted fix appears in this section.

### A. Adversarial review of the deterministic invariants

**Goal.** Attack the core engines' guarantees rather than read them.

**Scope.** `src/core/feasibility/`, `src/core/waves/`, `src/core/compromise/`,
`src/core/repair/`, `src/core/decisions/`.

**Expected output.** Concrete counter-examples, or a statement that none was
found, for each of: a hard constraint relaxed without approval; an `UNKNOWN`
collapsing into `SATISFIED`; a must-travel-with pair separated; a wave ranking
that is not a total order; a plan repair that changes more than it needed to; a
Decisions Preserved figure inflated by its denominator; money compared
inexactly; a group size assumed.

**Acceptance.** Every counter-example is either reproduced as a failing test and
fixed, or explained as not-a-defect with reasoning recorded here.

### B. Model Studio integration security review

**Goal.** Review the external boundary. **Only meaningful after live
verification** — reviewing an unexercised adapter reviews an assumption.

**Scope.** `src/adapters/`, `scripts/checkSecrets.mjs`, `scripts/preflight.mjs`,
the server actions in `app/`.

**Expected output.** Findings on: any path where a credential could reach a log,
a client bundle or an error message; any path where `MODEL_STUDIO_MODE` could be
bypassed; any way an unvalidated model response could reach the domain; SSRF
gaps in `core/research/url.ts`; and whether the recorded/live distinction can be
subverted.

**Acceptance.** Every finding fixed or recorded with a reason for not fixing.

### C. Browser QA of the hero flow

**Goal.** Exercise the demo as a person, not as a test runner.

**Scope.** `/`, `/demo`, `/demo/waves`, `/demo/journey`, `/demo/decisions`,
`/demo/participant/[id]`, `/understand`, `/research`.

**Expected output.** Anything that reads as more certain than it is; any private
figure on a group surface; keyboard and screen-reader problems; layout failures
at narrow widths; any place a fixture looks live.

**Acceptance.** Honesty and accessibility defects fixed. Cosmetic findings
recorded and triaged.

### D. Atlas adapter contract review

**Goal.** Check a real integration against real documentation.

**Scope.** `AtlasFlightProvider` and its fixtures, once Phase 7 exists.

**Expected output.** Any invented field, guessed status value or assumption not
supported by the documentation; any vendor field escaping the boundary; any
fixture that does not match a real recorded response.

**Acceptance.** No unsupported assumption survives.

### E. Final repository audit

**Goal.** One pass over the whole repository before submission.

**Scope.** Everything, including all Markdown.

**Expected output.** Any document claiming a capability that does not exist; any
stale test count or phase number; any `IMPLEMENTED` that has not been run; any
remaining reference to the startup repository as if it were this one.

**Acceptance.** `IMPLEMENTATION_STATUS.md` is true, and every other document
agrees with it.
