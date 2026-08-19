# Startup Boundary

**Status:** decision record.

> **Interpretation note.** The brief names this document but does not define its
> scope. It is written here as the boundary between what Orkestr builds itself
> and what it delegates to existing rails. If a different meaning was intended,
> this document should be corrected rather than worked around.

## 1. The boundary

| Orkestr builds | Orkestr delegates |
| --- | --- |
| Coordination between travellers | Flight inventory and booking (Atlas) |
| Constraint ownership and confirmation | Payment execution (existing rails) |
| Deterministic feasibility | Language understanding (Qwen) |
| Travel wave generation | Web research (Model Studio) |
| Compromise search | Maps, transit and venue data (providers) |
| Impact analysis and plan repair | Hotel inventory |
| Evidence provenance and honesty rules | |
| The journey package that ties it together | |

## 2. Why the boundary sits here

Principle 12: existing execution rails win. Building an airline booking system is
a solved problem owned by companies with far more resources, and doing it badly
would consume the entire project without producing anything distinctive.

What is **not** solved is the coordination problem: a group with conflicting
requirements, changing membership, private constraints and no willingness to fill
in forms. That is the whole of Orkestr's value, and it is where every unit of
effort should go.

## 3. Explicitly out of scope

- Expense splitting. Groups already have tools for this.
- Payment processing. Existing rails execute payments.
- Being a chat application.
- Being a travel content or recommendation site.

Orkestr coordinates what the group needs. Other systems execute.

## 4. Relationship to the earlier Orkestr

Orkestr 1.0 was a group **dining** product built around venue selection, bill
splitting and an x402 payment proof. It lives in a separate repository, is tagged
`orkestr-v1-x402-final`, and remains deployed and untouched.

Orkestr Travel deliberately does not inherit its code. The splitting and payment
subsystems are outside this product's boundary by design, and the earlier
constraint model has no ownership, no hard/soft split and no confirmation state,
so it is a redesign rather than an adaptation.

Reusable **patterns**, not code, worth revisiting later: capability-URL guest
access with no accounts, asymmetric constraint visibility, and provenance
discipline on researched facts.
