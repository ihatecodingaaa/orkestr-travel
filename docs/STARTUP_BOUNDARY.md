# Startup Boundary

**Status:** decision record. Binding on both repositories.

This document defines the separation between the **Orkestr startup** and the
**Orkestr Travel** hackathon build. It exists to stop two specific failures:
the hackathon quietly becoming the startup's roadmap, and hackathon-specific
vendor dependencies quietly becoming permanent startup dependencies.

---

## 1. Two repositories, two purposes

| | Orkestr startup | Orkestr Travel |
| --- | --- | --- |
| Repository | `orkestr_luc` | `orkestr-travel` |
| Purpose | The long-term Orkestr startup and product | Alibaba Cloud x Atlas Agentic AI Hackathon 2026 experimental travel vertical |
| Horizon | Indefinite | The hackathon, plus whatever is deliberately harvested afterwards |
| Status of its validation thesis | Authoritative | Does not replace or supersede it |

These are **separate efforts with separate lifetimes**. One is a company. The
other is an experiment run inside a competition, in one vertical, under a
deadline.

---

## 2. The Orkestr startup

Repository: `orkestr_luc`

The startup's core thesis is unchanged by anything in the hackathon:

```
complex multi-person intent
    -> minimum necessary questions
    -> constraint reconciliation
    -> private compromise
    -> group commitment
    -> existing execution infrastructure
```

That chain is domain-neutral on purpose. Dining was the first vertical it was
tested in. Travel is a second. Neither vertical is the thesis.

**The startup must not silently inherit hackathon-specific dependencies.**
Nothing becomes a startup dependency by having been convenient during a
hackathon weekend.

---

## 3. Orkestr Travel

Repository: `orkestr-travel`

An experimental travel vertical built for the Alibaba Cloud x Atlas Agentic AI
Hackathon 2026. It is a genuine build and a genuine test of the thesis in a new
domain. It is not the startup, and it is not a rewrite of the startup.

### Hackathon-specific technologies

The following are chosen because the hackathon calls for them, or because they
are the fastest credible route to a working demo:

- Atlas
- ATRIP
- Alibaba Cloud
- AgentRun
- Function Compute
- Model Studio / Qwen
- Qoder

**None of these is automatically a permanent Orkestr startup dependency.**

Each one is a hackathon-scoped choice. If any is later adopted by the startup,
that adoption is a separate, deliberate decision made on the startup's own
merits, recorded in the startup repository, and not inherited by default from
this build.

---

## 4. Porting back to the startup

Some capabilities being built here are generic. They solve the coordination
problem itself, not a travel-specific instance of it, and are therefore
candidates to be reviewed and ported back to the startup later:

| Capability | Built here yet? | Generic, or travel-shaped? |
| --- | --- | --- |
| Constraint ownership | Yes (Phase 1) | Generic. Any group decision has owners |
| Deterministic feasibility | Yes (Phase 1) | Generic. The rules differ; the shape does not |
| Dynamic membership | Yes (Phase 1) | Generic |
| Exact money comparison, no FX | Yes (Phase 1) | Generic, and useful anywhere budgets are compared |
| Time handling with mandatory offsets | Yes (Phase 1) | Generic |
| Compromise engine | Yes (Phase 3) | Generic. Any group decision has preferences to trade |
| Impact Radius | Yes (Phase 3) | Generic |
| Plan Repair | Yes (Phase 3) | Generic, and see the note below |
| Decision inventory and preservation | Yes (Phase 3) | Generic, and arguably the most portable idea here |
| Evidence and provenance patterns | Types only | Generic |
| Travel-Wave-style grouping | Yes (Phase 2) | **Unclear. See the note below** |

### Porting back must be intentional

A capability moves from Travel to the startup only through a deliberate review
that asks, at minimum:

1. Does this solve a general coordination problem, or a travel-shaped one?
2. Does it carry any hackathon vendor dependency with it? If so, can that
   dependency be removed cleanly?
3. Does it fit the startup's thesis chain in section 2, or does it bend that
   chain to fit the code?
4. Is it worth the maintenance cost in a codebase with a longer horizon?

Copying code across because it exists and works is not a review. Absent that
review, nothing here is a startup commitment.

**Travel-Wave grouping is called out deliberately.** Now that it is built, the
question is sharper rather than settled.

Splitting a group across departure days has no obvious equivalent in dining, so
the *feature* is probably travel-only. But three pieces underneath it are not:

- **Indivisible units** from a hard "must stay together" relationship. Any group
  coordination problem has people who cannot be separated.
- **Lexicographic ranking with a recorded deciding criterion.** Domain-neutral,
  and the reason the engine can explain itself without a language model.
- **Refusing to compare what cannot be compared** (mixed currencies skip the cost
  criterion entirely rather than being assigned a fabricated rate).

Those three are strong port-back candidates. The wave feature itself is not.
Either way, nothing moves without the review in this section.

**Phase 3 added three more that look genuinely domain-neutral.** The decision
inventory with an old-only preservation denominator, the distinction between
repairing and re-planning, and trip-scoped exceptions that never overwrite a
stated preference are all about coordinating people rather than about flights.
Dining has the same shapes: somebody joins late, somebody's budget is stretched,
and an agreed arrangement should not be torn up because a better one appeared.

They are still candidates, not commitments. The review in this section applies.

---

## 5. What the hackathon does not do

- It does **not** replace the startup's validation thesis.
- It does **not** make travel the startup's vertical.
- It does **not** commit the startup to any vendor listed in section 3.
- It does **not** retire, deprecate or supersede the `orkestr_luc` codebase.

Orkestr 1.0 in `orkestr_luc` remains preserved at the tag
`orkestr-v1-x402-final` and remains deployed and untouched. It is the startup's
history and its current running artefact, not dead weight.

---

## 6. Product boundary within Orkestr Travel

Separate from the startup/hackathon split above, this build also has an internal
boundary: what Orkestr writes itself, and what it delegates to existing rails.

| Orkestr Travel builds | Orkestr Travel delegates |
| --- | --- |
| Coordination between travellers | Flight inventory and booking (Atlas) |
| Constraint ownership and confirmation | Payment execution (existing rails) |
| Deterministic feasibility | Language understanding (Qwen) |
| Travel wave generation | Web research (Model Studio) |
| Compromise search | Maps, transit and venue data (providers) |
| Impact analysis and plan repair | Hotel inventory |
| Evidence provenance and honesty rules | |
| The journey package that ties it together | |

Principle 12: existing execution rails win. Building an airline booking system is
a solved problem owned by companies with far more resources, and doing it badly
would consume the whole project without producing anything distinctive.

What is **not** solved is the coordination problem: a group with conflicting
requirements, changing membership, private constraints, and no willingness to
fill in forms. That is where every unit of effort should go.

### Explicitly out of scope for Orkestr Travel

- Expense splitting.
- Payment processing.
- Being a chat application.
- Being a travel content or recommendation site.

---

## 7. Why Travel is a separate repository

Orkestr 1.0 is built around venue selection, bill splitting and an x402 payment
proof. Splitting and payments are out of scope here, and 1.0's constraint model
has no ownership, no hard/soft split and no confirmation state. That makes Travel
a redesign rather than an adaptation, so it was started clean.

Patterns from 1.0 worth revisiting later, as **patterns rather than code**:
capability-URL guest access with no accounts, asymmetric constraint visibility,
and provenance discipline on researched facts. Each is subject to the same
intentional review as section 4.
