# Hackathon Master Plan

**Event:** Alibaba Cloud x Atlas Agentic AI Hackathon 2026
**Status:** Phases 0, 1 and 2 complete. Phase 3 not started.

## 1. The thesis

> **Scope.** What follows is the thesis *for this hackathon build*. The Orkestr
> startup's own validation thesis is separate and is not replaced by it. See
> `STARTUP_BOUNDARY.md`.

Most agentic travel demos search for flights and write an itinerary. Both are
solved problems, and both are easy to fake convincingly.

Orkestr Travel takes the unsolved one: a group whose requirements do not fit
together, whose membership changes mid-plan, whose constraints are partly
private, and none of whom want to fill in a form. The demonstrable claim is that
the system finds the minimum split, the minimum compromise and the minimum set of
questions that make the trip possible.

## 2. What makes it defensible

| Claim | Why it holds up under inspection |
| --- | --- |
| It is not a wrapper around a model | Every feasibility decision is pure deterministic code with unit tests |
| Its honesty is structural | Evidence state, item status and capability state are types, not copy |
| Travel waves are a real algorithm | Deterministic, ranked, documented, 112 tests. Lexicographic, not a weighted score |
| "Decisions preserved" is a real number | The decision inventory is defined in `PLAN_REPAIR.md` and countable |
| Alibaba does genuine work | Extraction, research and orchestration, not a token endpoint |

## 3. Phase plan

Each phase ends with the full closing checklist in section 5. **Phases do not run
automatically. Each begins on founder instruction.**

| Phase | Content | Status |
| --- | --- | --- |
| 0 | Repository foundation, docs, tooling, domain types | **COMPLETE** |
| 1 | Group model, search window generator, feasibility engine | **COMPLETE** |
| 2 | Travel waves, reunion anchors | **COMPLETE** |
| 3 | Compromise, impact radius, plan repair, late join and leave | Not started |
| 4 | Mock provider, journey package, meals, local fixture demo | Not started |
| 5 | Local UI, mobile first, wave visualisation | Not started |
| 6 | Qwen extraction and web research, evidence | Needs approval |
| 7 | Atlas provider | Needs approval, documentation and credentials |
| 8 | Persistence, private multi-user | Needs an infrastructure decision |
| 9 | Alibaba Cloud deployment | Needs explicit infrastructure approval |
| 10 | Atlas sandbox order | Needs explicit approval |
| 11 | Qoder review stages | Performed in Qoder |
| 12 | Demo hardening, no new features | Not started |

## 4. Sequencing risk

The two phases with external dependencies (6 and 7) are also the two that carry
the judging weight. Phases 1 to 5 deliberately produce a complete, demonstrable
product using a mock flight provider and no AI, so that a credential delay
degrades the demo rather than destroying it.

Stated plainly: **if Atlas access never arrives, there is still a working product
to show, honestly labelled as running on local fixtures.**

## 5. Closing checklist for every phase

1. Inspect the code changed.
2. Run the relevant tests.
3. Review the implementation.
4. Inspect every markdown file.
5. Update every affected document.
6. Confirm no document claims unimplemented functionality.
7. Update `IMPLEMENTATION_STATUS.md`.
8. Run lint.
9. Run typecheck.
10. Run tests.
11. Run the production build, once one exists.
12. Inspect the git diff.
13. Report exactly what changed.

## 6. Standing rules

- No infrastructure without explicit founder approval.
- No claimed integration until it has been verified by running it.
- Historical documents stay labelled historical; they are not deleted to avoid
  updating them.
- `IMPLEMENTATION_STATUS.md` outranks every other document on questions of what
  works.
