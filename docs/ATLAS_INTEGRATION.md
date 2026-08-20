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
