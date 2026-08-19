# Alibaba Cloud

**Status:** `BLOCKED` (Phase 6 for Qwen, Phase 9 for infrastructure).
**No Alibaba Cloud resource has been provisioned. No credential exists. No
endpoint has been called.**

## 1. Position

Alibaba Cloud must provide **genuine product capability**, not a token endpoint
deployed so the project can claim usage. If it is not doing real work, it should
not be in the architecture.

The genuine capabilities are:

| Capability | What it does for the product |
| --- | --- |
| Qwen structured extraction | Turns "I cannot do early mornings" into a proposed constraint with an owner |
| Qwen ambiguity detection | Notices what is unclear and worth one question |
| Model Studio web research | Finds evidence about venues, access and suitability |
| Agent runtime and tool calls | Orchestrates the extract, research and explain steps |
| Qwen explanation and wording | Explains a compromise in plain language |

## 2. What Qwen may never do

Decide hard feasibility. Compare budgets. Compare flight times. Decide wave
membership where hard rules apply. Enforce must-travel-with. Judge fare validity.
Judge commitment validity. Apply impact-radius business rules.

All of those are deterministic code. See `ARCHITECTURE.md`.

## 3. Structured output

Where the task produces machine-readable information, Qwen must return structured
output, which is then validated before it enters the domain. An extraction that
fails validation is a failure, not a partially-trusted result.

## 4. Runtime

Preferred: Alibaba Cloud AgentRun. Fallback: Alibaba Cloud Function Compute.
Neither has been provisioned or evaluated.

## 5. Infrastructure rule

**No cloud infrastructure may be provisioned without explicit founder approval.**

Phase 9 is an infrastructure phase and does not begin automatically. This
document must be updated with what was actually created, when, and by whom, at
the moment anything is provisioned.

## 6. Current infrastructure

**NONE.**
