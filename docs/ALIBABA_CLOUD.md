# Alibaba Cloud

**Status:** Model Studio integration `IMPLEMENTED` in code (Phase 6).
Infrastructure `BLOCKED` (Phase 9).

**No Alibaba Cloud resource has been provisioned. No live Model Studio call has
ever been made from this repository, because no credential exists in the
development environment.** The client code is written, tested against recorded
response bodies, and has not been executed against the service.
`IMPLEMENTATION_STATUS.md` outranks this document.

## 1. Position

Alibaba Cloud must provide **genuine product capability**, not a token endpoint
deployed so the project can claim usage. If it is not doing real work, it should
not be in the architecture.

The capabilities Phase 6 actually builds on:

| Capability | What it does for the product | State |
| --- | --- | --- |
| Qwen structured extraction | Turns "I cannot do early mornings" into a proposed constraint with an owner and the quote it came from | Code implemented |
| Qwen ambiguity detection | Notices what is unclear and worth exactly one question | Code implemented |
| Model Studio web search | Finds real, citable sources about venues, access and suitability | Code implemented |
| Model Studio web extraction | Reads a selected page, including one a user shared | Code implemented |
| Agent runtime | Would host the above | Not provisioned, Phase 9 |

## 2. What Qwen may never do

Decide hard feasibility. Compare budgets. Compare flight times. Decide wave
membership. Enforce must-travel-with. Judge fare validity. Judge commitment
validity. Apply impact-radius rules. Compute Decisions Preserved.

All of those are deterministic code and were built in Phases 1 to 4.

This is not a policy that relies on discipline. `tests/phase3Safety.test.ts`
reads every file under `src/core` and fails the build if any of them names a
model provider, reads a clock, uses randomness, or touches the network.

## 3. What Qwen may never confirm

Anything. See `QWEN_INTEGRATION.md` section 6: the schema refuses the fields
that carry authority, the JSON Schema sent to the provider does not offer them,
and the mapper writes `origin: "MODEL_PROPOSED"` and
`confirmation: "PROPOSED"` as literals.

## 4. Endpoints used

OpenAI-compatible interface, Singapore (`ap-southeast-1`) by default:

| Purpose | Path |
| --- | --- |
| Structured extraction | `/compatible-mode/v1/chat/completions` |
| Web research | `/compatible-mode/v1/responses` |

The workspace-specific host is built from configuration. No personal workspace
id is committed to this repository. See `QWEN_INTEGRATION.md` section 2.

## 5. Models

Environment-configurable, defaulting to `qwen3.7-plus` for both operations.
Nothing is architected around one model name, and a more expensive model is
never selected automatically as a fallback. If a larger model is evaluated
later, that is recorded as an evaluation result rather than becoming a silent
upgrade path.

## 6. Structured output

Qwen returns structured output, which is then validated before it enters the
domain. An extraction that fails validation is a **failure**, not a
partially-trusted result.

Model Studio's own documentation is inconsistent about JSON Schema mode, so this
build defaults to the unambiguously documented `json_object` and treats neither
mode as the guarantee. The guarantee is `src/core/intent/schema.ts`. See
`QWEN_INTEGRATION.md` section 3.

## 7. Cost observability

Where Model Studio reports token usage, it is recorded in server diagnostics and
shown on the screen that triggered the call: model, operation, duration, input
and output tokens, tool calls, sources collected, success or failure.

**No dollar estimate is displayed.** No pricing is configured, and an invented
figure would be worse than no figure.

## 8. Runtime

Preferred: Alibaba Cloud AgentRun. Fallback: Function Compute. **Neither has
been provisioned or evaluated.** Phase 6 runs Model Studio calls from local
server-side code only.

## 9. Infrastructure rule

**No cloud infrastructure may be provisioned without explicit founder approval.**

Phase 9 is an infrastructure phase and does not begin automatically. This
document must be updated with what was actually created, when, and by whom, at
the moment anything is provisioned.

## 10. Current infrastructure

**NONE.**

No Vercel, no Railway, no Neon, no Koyeb, no AgentRun, no Function Compute, no
DNS, no database, no deployment of any kind. Phase 6 changed none of that: it
added client code that would call a service, not a service.
