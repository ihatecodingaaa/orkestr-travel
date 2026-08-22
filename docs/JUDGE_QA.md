# Judge and investor Q&A

Every answer here is true. Where the honest answer is a weakness, it says so —
a judge who catches one dodge stops believing the rest.

---

## The sceptical questions

**Isn't this just ChatGPT itinerary planning?**
No. Ask ChatGPT for a Tokyo itinerary and it writes one. Tell it Ryan joined and
it writes a *new* one. Orkestr's whole behaviour is the opposite: it identifies
what broke, changes only that, and tells you the ten decisions it did not touch.
The model here never decides who flies when.

**Why can't everyone just use a group chat?**
They do, and that's the problem. A group chat has no idea that Grandma's Tuesday
constraint and Ryan's Wednesday constraint are incompatible, that a dinner
depends on a flight arrival, or that changing one flight invalidates one
decision and not nineteen others.

**What does the AI actually decide?**
Nothing consequential. Qwen turns messy conversation into structured
*proposals* and researches evidence. Who flies when, what anybody can afford,
whether a repair is valid, and when to stop are all deterministic code. **AI
proposes. Code decides.**

**What happens if the model hallucinates?**
Structured output is parsed and schema-checked, not trusted. Research claims may
only cite a URL the search tool actually returned — a fabricated citation is
rejected by name. Claims are bound to an entity by an identifier *we* issued, so
a model inventing `some-other-temple-123` gets nothing. And no model output can
change a hard constraint.

**Is the Tokyo flight really from Atlas?**
**No, and the screen says so.** Tokyo is a deterministic demo scenario. Atlas
Sandbox serves a bounded set of test routes and does not carry it.

**Then why is Atlas showing Hong Kong to Manila?**
Because that is a route the sandbox actually serves. We proved the provider
lifecycle — search, then verify — on a route where it genuinely works, rather
than pretending the sandbox contains every route. Showing the seam is more
defensible than hiding it.

**How do you know Atlas works at all, then?**
It was run live. `FLIGHT_SEARCHED` returned two offers in about 2.6 seconds; one
was then verified with `OFFER_VERIFIED`, price unchanged, in about 2.3 seconds.
Both are recorded in `docs/ATLAS_INTEGRATION.md` with latencies.

**What happens if Atlas is down?**
The run terminates as `PROVIDER_UNAVAILABLE` and nothing is changed. There is
deliberately **no** fallback from a failed live call to fixture data — that would
put made-up flights on screen under a provider label.

**What happens when a price changes?**
The provider reports the new price; it does not decide what it means. Orkestr
compares it in exact integer minor units against each traveller's own
constraints. A hard limit invalidates the commitment. A soft preference produces
a compromise proposal for the person who owns it.

**What if one traveller refuses the compromise?**
It stays refused. Their constraint remains as stated, and the plan is either
repaired another way or reported as unresolved. Nothing is relaxed automatically.

**Can the organiser override another person's constraint?**
No, and it is not silently ignored either — it is a hard failure. An approval
from somebody who does not own the constraint makes the whole repair
`INVALID_REQUEST`, because a caller who believes a traveller agreed must be told
when that belief is wrong.

**How do you prevent an infinite agent loop?**
A hard step budget with exactly one counting site, no recursion and no path to a
terminal state with an inaccurate count. Hitting it produces
`STEP_LIMIT_REACHED`, which is a distinct terminal state — it never becomes
success. Tested at every limit from one to seven against every repair status.

**How do you know a repair actually worked?**
Because "the function returned success" and "the journey is valid" are checked
separately. `postconditionsHold` looks for a missing plan, surviving hard
blockers, unestablished requirements, and a search that stopped at its limit.
Any of those produces `OUTCOME_NOT_CONFIRMED` even when the engine said it
succeeded. **This is the false-success problem, and it is the failure most agent
demos have.**

**Why not just regenerate the whole itinerary? Compute is cheap.**
Compute is cheap; *agreement* is not. Those ten decisions represent a group of
adults negotiating with each other. Throwing them away because a fare moved is
not optimisation, it is telling seven people to have the argument again.

**How much of this is live?**
Qwen extraction, the Responses API, `web_search`, `web_extractor`, entity-bound
claims, Atlas sandbox search and Atlas verification are all live-verified. The
demo deliberately runs from recorded results so it does not depend on a network.
Every screen labels its own source; there is no global "LIVE" badge.

**Why is research recorded rather than live?**
Live research measured 54–76 seconds, with timeouts. That is unusable in a
three-minute video, and the reason is documented: Atlas's `web_extractor`
requires thinking mode, and thinking mode is the latency.

**Are these production fares?**
No. Sandbox fares are test data and cannot be purchased. Production Atlas is not
authorised, and there is no `production` value in the mode type at all.

**Can it book flights?**
No. There is no order, payment or ticketing path. The account reports
`ticketing_available: true`, and that is treated as a capability, not an
authorisation.

**What happens with 30 travellers?**
The wave search is bounded and reports when it hits its limit rather than
claiming a complete answer. Honestly: it has not been load-tested at that size,
and the interesting failure is combinatorial, not performance.

**Where is Alibaba Cloud used?**
Model Studio does the language understanding and the evidence research, both
live-verified. It is on the `/demo/agent` architecture card and the home
provenance board.

**Where is Qoder used?**
It is not. See `docs/JUDGING_RUBRIC_AUDIT.md` — this is a known scoring risk that
has not been papered over.

---

## Investor questions

**Who pays?**
The organiser — the person who currently does this coordination unpaid in a
group chat. Secondary: operators who want group bookings that do not fall apart.
Not modelled beyond that, and it would be dishonest to pretend otherwise.

**Why now?**
Two things changed. Models became good enough to read a real group conversation
rather than requiring a form. And travel providers began exposing agent-shaped
interfaces — Atlas is one — so an agent can verify a fact rather than scrape a
page.

**Why can't Google or ChatGPT do this?**
They can generate a better itinerary than us today. What they do not have is
*state*: whose constraint is hard, who confirmed what, which decisions a group
already agreed to, and what a change invalidates. A chat interface regenerates
because it has nothing to preserve. The moat is the decision record, not the
prompt.

**What is the wedge?**
Multi-person trips where people cannot travel identically — multigenerational
family trips, weddings, reunions. Small, painful, badly served, and the exact
case where regeneration is most obviously wrong.

**What expands after travel?**
The primitives are not travel-specific: conflicting constraints, private
preferences, dependency-aware repair, decision preservation. Weddings and events
are the nearest neighbours. **No market-size figure is offered here, because any
number invented for a pitch would be fiction.**

**What is the defensibility?**
Not the model — that commoditises. The defensible part is the accumulated
decision graph for a group, plus the coordination rules that make repair
trustworthy. A competitor can copy the interface in a weekend; they cannot copy
what your group already agreed to.

**Biggest risk?**
Frequency. People take few group trips a year, so this is not a habit product.
The honest answer is that it either expands into adjacent coordination or it
stays a seasonal tool.
