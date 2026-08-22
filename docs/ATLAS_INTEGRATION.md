# Atlas Integration

**Status:** `BLOCKED` (Phase 7). **No Atlas code exists. No endpoint has been
called. No credential exists in this repository.**

## 1. Position

Orkestr is not an airline booking system and will not pretend to be one. Flights
are executed on an existing rail. Atlas provides that rail; Orkestr provides the
coordination that decides which flights the group should be on.

## 2. The boundary

`FlightProvider` in `src/domain/flight.ts` defines three operations:
`searchFlights`, `verifyOffer`, `createSandboxOrder`.

No Atlas-specific field name may travel past this interface. Responses are
normalised into `FlightOffer` at the adapter, so a change in their payload shape
touches one file.

| Implementation | Phase | Status |
| --- | --- | --- |
| `MockFlightProvider` | 4 | `IMPLEMENTED` |
| `AtlasFlightProvider` | 7 | `BLOCKED` |

### The contract shrank in Phase 4

`createSandboxOrder` was **removed**. Nothing called it, and its shape was a guess
about an Atlas API nobody has read. **A method invented ahead of an integration is
a method the real provider will not match.** What remains is what the system
actually does: `searchFlights`, `verifyOffer` and `getCapabilities`.

Order creation will be added in Phase 10, in whatever shape the real
documentation turns out to require.

### MockFlightProvider is a development adapter

It is **not** a simulation of Atlas and carries no vendor branding. It exists so
the lifecycle can be exercised offline: a searched offer is not a verified one, a
verified price can differ, and an offer can vanish between the two.

`AtlasFlightProvider` will implement the same contract in Phase 7, **but only
where Atlas is confirmed to support it.** Anything Atlas cannot do stays
`UNSUPPORTED` or `UNKNOWN` rather than being faked to fit the interface. A test
asserts no vendor name appears anywhere in generic business logic.

## 3. Entry conditions for Phase 7

All of these must be true before any Atlas code is written:

1. The founder has explicitly approved starting Phase 7.
2. Real API or Skill documentation has been read.
3. Sandbox credentials exist.

**No guessed endpoints. No invented request shapes.** If the documentation has
not been inspected, the integration does not start.

## 4. Sandbox only

Development uses the sandbox exclusively. `SandboxOrderResult.isSandbox` is typed
as the literal `true`, so a code path that returned a production order would not
compile. Sandbox data is always visibly labelled in the UI.

Phase 10 (creating a sandbox order at all) requires its own explicit approval.

## 5. Capabilities are tri-state, for a reason

`ProviderCapabilityState` is `SUPPORTED`, `UNSUPPORTED` or `UNKNOWN`.

A boolean would force a guess. Today we genuinely do not know whether the Atlas
sandbox supports meal selection or special-service requests, so the honest value
is `UNKNOWN`. When a capability is `UNKNOWN` or `UNSUPPORTED`, the product
creates a handoff or confirmation task instead of claiming the request was made.

**Meal and special-assistance operations will not be claimed until a real
integration proves they work.**

## 6. Evidence states

Every offer records how it was obtained:

| State | Meaning |
| --- | --- |
| `LOCAL_FIXTURE` | Hand-written fixture. Never real availability |
| `RECORDED_ATLAS_SANDBOX` | A real sandbox response captured earlier, replayed |
| `ATLAS_SANDBOX_SEARCH` | Live call to the sandbox search endpoint |
| `ATLAS_VERIFIED` | Re-checked just now |
| `STALE` | Older than the freshness window |
| `PRICE_CHANGED` | Re-check returned a different price |
| `UNAVAILABLE` | Re-check found it gone |
| `UNKNOWN` | Provenance not established. Treated as unusable |

**Recorded data is never labelled live.** A recorded fallback for demo
reliability is legitimate; presenting it as a live search is not.

## 7. Never

Production bookings during development. Real passenger identities in fixtures.
Credentials in the repository.

---

## 8. Phase 7 readiness checklist

**Everything in this section is a QUESTION, not a specification.** No Atlas
documentation has been read from this repository, no endpoint has been called,
and no payload shape is known. Nothing below may be turned into code until it
has been answered from real documentation or a real response.

A guessed answer here is worse than an open question, because a guess gets
implemented and then defended.

### Authentication and access

- [ ] How is a request authenticated? Header, scheme, token lifetime?
- [ ] Is there a separate sandbox credential, and a separate sandbox host?
- [ ] What identifies the environment in a response, so a sandbox result can
      never be rendered as production?
- [ ] Rate limits: what are they, and what does exceeding one return?

### Flight search

- [ ] Endpoint, method, and request shape
- [ ] How are origin and destination expressed? IATA city, IATA airport, both?
- [ ] How is a date expressed, and in whose time zone?
- [ ] Are one-way and return searched separately, or as one request?
- [ ] **Passenger count behaviour.** Does a search for seven return offers that
      can seat seven, or offers priced per passenger with availability
      unstated? This one materially changes the wave engine's meaning of a
      "fitting" traveller
- [ ] Is availability returned at all, or only price?
- [ ] What is returned when nothing matches: empty list, error, or partial?

### Offer verification

- [ ] Endpoint and request shape for re-checking a specific offer
- [ ] How long is an offer valid? Is there an explicit expiry?
- [ ] **Price-change semantics.** Does verification return a new price, an
      error, or a new offer with a new identifier?
- [ ] What distinguishes "price changed" from "no longer available"?
- [ ] Is a verified offer reservable, or still only a quote?

### Data completeness

- [ ] Baggage: is the allowance returned? Distinguishable from "not stated"?
      The domain models `unknown: true` separately from zero, and needs to keep
      doing so
- [ ] Seat information and seat selection capability
- [ ] Meal ancillary: supported, and how represented?
- [ ] **Special assistance: supported, and how represented?** Currently
      `UNKNOWN` everywhere. Nothing may claim an operator can meet an
      accessibility need until Atlas actually says so
- [ ] Fare rules and change/cancel terms
- [ ] Which fields can legitimately be absent?

### Sandbox and ordering

- [ ] Is there a known-good sandbox route and date pair for smoke testing?
- [ ] Sandbox order creation: endpoint, shape, and what state it leaves behind
- [ ] Ticketing states, and how they are polled or notified
- [ ] Is any part of the sandbox capable of a real charge? (Assume yes until
      documented otherwise.)

### Verification before implementation

1. Read the real documentation.
2. Run one real search. Record the actual response shape.
3. Verify one real offer. Record what changes between the two.
4. Only then write `AtlasFlightProvider`, behind the existing boundary.
5. Add sanitised fixtures from the real shapes, and test against those.

### What Phase 7 must not do

- Invent an endpoint, a field name or a status value
- Add a method to `FlightProvider` that the real API does not need. The
  contract already shrank once for exactly this reason; see section 2
- Let an Atlas field name past the adapter
- Mark assistance as supported before Atlas states it
- Call a live or paid endpoint from any test
- Create a production order

## What the real CLI actually does (verified, 22 August 2026)

CLI `atlas-flight 0.3.12`, from PyPI via `uv`. Skill installed from
`atlas-doc/atlas-flight-booking-skill`, Apache 2.0.

### Findings that changed the design

**1. Production is the default.** Straight from the official README: *"Atlas
Flight Booking uses production services by default."* Sandbox is opt-in, per
machine, and a bug that merely fails to switch is a bug that searches live fares.

**2. There is no way to READ the current environment.** `environment use
sandbox` and `environment use production` exist. `environment`, `environment
show`, `environment status` and `environment current` all return
`INVALID_ARGUMENT`. So "check we are in sandbox and stop if not" is not
implementable, and the only available proof is to SET sandbox and read the
confirmation back. That is what `proveSandbox` does, immediately before every
operation -- which removes the gap a read-then-act check would leave. **Orkestr
cannot select production: the string appears in no argument array it can build.**

**3. A terminal error exits ZERO.**

```
$ atlas-flight environment --json ; echo $?
{"schema_version":"1","status":"terminal_error","code":"INVALID_ARGUMENT",...}
0
```

An adapter that trusted exit codes would treat every Atlas failure as a success.
Success is decided by the envelope, never by the exit code.

**4. Search is two commands, not one.** `search` returns a `search_id`;
`offer list --search-id` returns the offers.

**5. The contract forbids `--help`.** *"Never run `--help`, probe variants,
inspect configuration, or call a service directly."* Command discovery came from
the Skill's own `references/cli-contract.md`, not from probing. The one
exception was four `environment` sub-commands, checked because proving sandbox
is a hard safety requirement and the read command's existence had to be
established. All four are local, read-only and non-flight.

### The envelope

```
{schema_version, status, code, message, retryable, request_id, data, details}
```

*"Branch on `code`; never parse `message`."* So `message` is carried for
diagnostics and never matched against; English wording from somebody else's
release notes is not a control flow input.

### Offer freshness is a provider concept, not just ours

Offers carry `bookable` and `price_status` (`current` | `reference`). A
`reference` price is comparison-only and cannot be verified at all. Orkestr does
not spend a call discovering this: it refuses to verify such an offer locally.

Verification returns `price_change` (`unchanged` | `decreased` | `increased`),
`previous_price`, `current_price`, `currency`, `baggage_supported`,
`seat_supported`. An unreadable `price_change` is **not** treated as unchanged.

### What is NOT verified against a real payload

The itinerary shape inside an offer -- field names for segments, carrier,
flight number, departure and arrival -- **is not documented anywhere in the
Skill**, and no authorised call has been made. The parser accepts a small list of
candidate names per field and **fails closed naming the missing field** rather
than guessing. The first authorised sandbox search settles this; the candidate
lists should then shrink to what Atlas actually sends.

A half-populated flight offer is worse than none: it reaches a screen and
somebody plans around it.

## Live closeout, 22 August 2026

Authorization completed by the founder. `doctor` reports `DOCTOR_OK` with every
check true; `auth status` reports `AUTHORIZED`, `authenticated: true`,
`search_available: true`, `ticketing_available: true`.

### The sandbox proof was broken, and the way it was broken matters

The Phase 7 implementation required Atlas to ECHO the environment back, and
refused with:

> "Atlas did not state which environment is active, and an unstated environment
> is not a proven one."

That sounds rigorous and is impossible. The real confirmation is:

```json
{"schema_version":"1","status":"success","code":"CONFIGURATION_UPDATED",
 "message":"Atlas configuration updated","data":{}}
```

**An empty `data` object. Atlas never sends an environment field.** So the guard
could not pass, and it blocked the first authorised search.

A guard that can never succeed is not a safe guard. It is a broken one that
happens to fail in the safe direction -- and it is exactly the kind of thing that
gets ripped out under time pressure by somebody who trusts it less carefully than
the person who wrote it.

### The corrected proof: set-then-confirm

The proof is now about what **we did**, not about what Atlas said back:

1. Orkestr invoked exactly its internal sandbox argument array (a module-scope
   constant, no interpolation site, no caller parameter).
2. The envelope parsed and `status` is `success`.
3. The code is on the allow-list `["CONFIGURATION_UPDATED"]`.

The word "sandbox" in the result comes from the command this module executed, not
from pretending Atlas confirmed a value it never sends. `proofMethod` records
this as `EXPLICIT_SET_CONFIRMED`.

**Still fail-closed.** A `status: success` with an unrecognised code is refused:
that means the CLI's behaviour moved, and the answer to that is to stop. Adding a
code is a deliberate act with the official contract in hand.

**LIVE VERIFIED**: proven in 1,076ms and again in 1,265ms.

### Atlas Sandbox search is failing server-side

Four consecutive searches, immediately after a confirmed sandbox switch:

| Route | Date | Latency | Result |
|---|---|---|---|
| SIN to NRT | 2026-11-17 | ~3.5s | `terminal_error` / `INTERNAL_ERROR` |
| KUL to SIN | 2026-09-05 | 2,429ms | `terminal_error` / `INTERNAL_ERROR` |
| KUL to SIN | 2026-08-29 | 2,432ms | `terminal_error` / `INTERNAL_ERROR` |
| KUL to SIN | 2026-09-20 | 2,783ms | `terminal_error` / `INTERNAL_ERROR` |

`KUL to SIN` is the **official documented example route** from the Skill README.
Every response carried `retryable: false` and an empty `data`.

Two routes, four dates, a healthy authorized CLI, and an identical fault.

> **THIS CONCLUSION WAS WRONG, and it is left here because being wrong in this
> particular way is worth remembering.**
>
> At the time I wrote: *"The Atlas Sandbox search service is failing on Atlas's
> side."* Four failures across two routes felt like enough to generalise from.
> It was not. A later search on **HKG to MNL succeeded**, returned two offers,
> and established the real provider contract -- see the section below.
>
> What the four failures actually established is narrower and more useful:
> **Sandbox has a bounded test dataset, and a valid IATA route is not
> necessarily a supported one.** SIN-NRT and KUL-SIN are not in it; HKG-MNL is.
> Atlas reports the difference as `INTERNAL_ERROR` rather than as a routing
> message, which is unhelpful of it but is not an outage.
>
> The mistake was reaching for the widest explanation that fitted, when a
> narrower one fitted equally well and was cheaper to test.

Production was NOT tried, and must not be: it is not representable in this
application and it is not authorised.

`INTERNAL_ERROR` is absent from `error-handling.md`. It is classified as
`PROVIDER_UNAVAILABLE` rather than left `UNRECOGNISED`, because the latter
renders as "this application does not handle that" and points an operator at our
code for a fault that is not ours. It is deliberately NOT added to the transient
list, so it is never retried.

### Consequently still unproven

Offer list, the real offer payload shape, normalisation against a real payload,
and verification. The itinerary field names remain undocumented and unobserved.
No recorded Atlas Sandbox fixture exists, and **none has been fabricated** -- a
recorded fallback must come from a real successful run or it is a lie with a
timestamp on it.

## The real payload, at last (22 August 2026)

`HKG to MNL`, 2026-09-05, one adult. `FLIGHT_SEARCHED`, two offers, 2.6-3.5s.

### Search returns offers directly

```
data.search_id, data.offer_count, data.offers[]
```

The adapter previously issued `offer list --search-id` after every search,
because the contract lists both commands and no offer had ever been seen. It is
now ONE call: the offers are already in the search response, and `offer list` is
documented as replaying a RETAINED search -- a recovery path, not a step.
`search_id` is still kept, because replay is the documented recovery when an
offer expires.

### The offer shape

```
offer:   offer_id, currency, total_price, transaction_fee_total,
         passenger_prices[], segments[], ancillary_supported[],
         bookable, price_status, refresh_time, expire_time
segment: departure_airport, arrival_airport, departure_time, arrival_time,
         carrier, operating_carrier, flight_number, duration_minutes,
         cabin_class, direction
```

Almost none of this matched the names the previous parser guessed from the
workflow documentation. It failed closed and named the missing field, exactly as
designed -- but "fails safely" is not the same as "works", and the design was
only ever a way to survive being wrong, not a substitute for being right.

### Money: JSON numbers, and a real float artifact

Atlas sends `101.29`, `209.6`, `0.0` as JSON **numbers**. One of the real values
is a genuine IEEE artifact:

```
135.73 * 100 === 13572.999999999998     // the connecting offer's tax
```

Truncating that -- any `| 0`, `Math.trunc` or `parseInt` on the product -- gives
13572, and the fare is a cent short. A later comparison then reports a price
change that never happened, which is worse than a wrong total: it manufactures a
decision. Amounts are rendered with `toFixed(scale)` and handled as integer
strings. Currency comes from Atlas and is never inferred: it priced a **Hong Kong
departure in USD**, so guessing HKD would have been wrong on the first payload.

### Time: NO timezone offset anywhere

```
"departure_time": "202609051750"
```

YYYYMMDDHHMM. A wall clock, with no zone, and none available elsewhere in the
response. The engines need real instants -- feasibility compares an arrival to a
deadline in another country, wave planning sorts on a timeline.

There were three honest options. Invent an offset (never: an eight-hour error
would be invisible and would look perfectly well-formed). Reject every Atlas
offer (honest, useless). Or use a real, explicit, deliberately tiny table of
airports whose UTC offset is **fixed all year**, and reject everything else.

`localTime.ts` is the third. The rule that makes it defensible:

> **AN AIRPORT MAY ONLY BE LISTED IF ITS ZONE HAS NO DAYLIGHT SAVING.**

For a zone that never shifts, the offset is a property of the place, not a guess
about the date. Hong Kong is +08:00 every day of every year; London is not, and
London must never appear there. An unlisted airport rejects the offer **by name**.
`LHR`, `JFK`, `CDG`, `SYD` and `AKL` are asserted absent.

Atlas's own `duration_minutes` is used rather than recomputed from the
timestamps, which keeps the provider's figure and our reconstruction
independent -- and on the real payload they agreed.

### Everything else stays a provider fact

* `cabin_class: 1` is carried as a **number**. The Skill documents no mapping, so
  calling it "Economy" would be a guess printed next to a price.
* `ancillary_supported: ["baggage"]` is preserved exactly. Baggage support says
  nothing about seats, and neither says anything about assistance. The baggage
  **allowance** stays unknown: "a bag can be added" and "a bag is included" are
  different sentences.
* `operating_carrier` was `null` and is simply absent.
* `bookable: true` is not booked. `price_status: "current"` is not verified.

### Verification, live

`atlas-flight offer verify --offer-id ... --json` returned `OFFER_VERIFIED` in
2.3-3.6s:

```
price_change: "unchanged", previous_price: 101.29, current_price: 101.29,
currency: "USD", booking_id: "book_...", baggage_supported: true,
seat_supported: false
```

Every field the workflow documentation described was present and correctly named,
so the verify parser needed no change.

The response also carries `requirements.required_fields` and `travelers[]`. Both
are **deliberately not read and not recorded**: they drive order creation, which
this application does not do, and the first is a list of passenger identity
fields. Parsing data we have no use for is how it ends up somewhere it should not.

### Offers expire in about fifteen minutes

`expire_time` was ~15 minutes after `refresh_time`. The adapter now refuses to
verify a past-expiry offer **without spending a call** -- asking would buy an
error that reads like a provider fault rather than a stale offer.
