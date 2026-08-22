# Demo claim map

Every sentence of the narration, annotated with what backs it. **This is for
truth auditing, not for the script** — the spoken version says none of these
labels out loud.

Categories: `LIVE VERIFIED` · `RECORDED VERIFIED` · `DETERMINISTIC` ·
`DEMO SCENARIO` · `PRODUCT VISION`.

| Narration | Backing | Note |
|---|---|---|
| "Planning a group trip isn't a search problem" | `PRODUCT VISION` | Framing, not a factual claim |
| "Seven people… Grandma Tuesday… Ryan Wednesday" | `DEMO SCENARIO` | Fictional family fixture |
| "most travel tools throw the itinerary away" | `PRODUCT VISION` | Characterisation of alternatives |
| "reads the conversation using Alibaba Cloud Model Studio" | `LIVE VERIFIED` | Extraction verified live; the demo may replay a recorded result |
| "stays a proposal until the person confirms it" | `DETERMINISTIC` | Authority boundary, enforced in code |
| "splits into Travel Waves by confirmed availability" | `DETERMINISTIC` | No model involved |
| "not by asking a model what it thinks" | `DETERMINISTIC` | Verified by absence — no model call on that path |
| "the group isn't together until the second wave lands" | `DETERMINISTIC` | Reunion anchor |
| "every claim cites a page that was genuinely fetched" | `LIVE VERIFIED` | Actual-source invariant; fabricated citations rejected |
| "official sources and community opinion never mixed up" | `LIVE VERIFIED` | Community evidence cannot establish an operational fact |
| "Orkestr connects to Atlas" | `LIVE VERIFIED` | Search and verify both run live |
| "this is a recorded Atlas Sandbox search and verification" | `RECORDED VERIFIED` | Taken from a real verified run |
| "Hong Kong to Manila" | `RECORDED VERIFIED` | Real route; the sandbox serves it |
| "so the demo doesn't depend on an offer that expires" | `LIVE VERIFIED` | Real offers expired ~15 min after search |
| "Sandbox fares are test data" | `LIVE VERIFIED` | Atlas documents it; not purchasable |
| "it re-checks the fare before relying on it" | `LIVE VERIFIED` | `OFFER_VERIFIED`, ~2.3s |
| "Ryan joins, a week late" | `DEMO SCENARIO` | Fixture event |
| "works out what this actually affects" | `DETERMINISTIC` | Impact analysis |
| "tells you what stayed exactly as it was" | `DETERMINISTIC` | Unchanged waves are recorded, not inferred |
| **"Ten of ten earlier decisions kept"** | `DETERMINISTIC` | **Computed from the real decision inventory. Not hard-coded** |
| "One new decision added: Ryan's" | `DETERMINISTIC` | Added decisions never enter the denominator |
| "the fare moves" | `DEMO SCENARIO` | **Simulated.** The real verification returned *unchanged* |
| "above one traveller's private budget" | `DETERMINISTIC` | Exact integer minor units |
| "asks that one person, privately" | `DETERMINISTIC` | Owner authority; a wrong owner is a hard failure |
| "five steps of a hard limit of seven" | `DETERMINISTIC` | Counted at one site |
| "zero whole-trip rebuilds" | `DETERMINISTIC` | Repair never replans globally |
| "zero AI calls during the repair" | `DETERMINISTIC` | The repair path contains no model call |
| "AI proposes and code decides" | `DETERMINISTIC` | Architectural claim, verifiable in the repository |
| "it never reports success it hasn't checked" | `DETERMINISTIC` | Postconditions can contradict the engine |
| "Travel together, even when you can't travel the same way" | `PRODUCT VISION` | Closing line |

## Sentences that must never be said

* "These are real fares" — sandbox is test data.
* "This Tokyo flight came from Atlas" — it did not.
* "The price changed live" — the real verification returned unchanged.
* "Fully autonomous" — it stops and asks a person by design.
* "It books your flights" — there is no booking path.
