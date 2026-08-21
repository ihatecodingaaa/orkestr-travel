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
