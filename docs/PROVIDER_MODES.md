# Provider Modes

**Status:** `IMPLEMENTED`. `MODEL_STUDIO_MODE` in
`src/adapters/modelStudio/config.ts`, applied in `src/adapters/registry.ts`,
asserted by `tests/serverActions.test.ts`.

---

## 1. Why this exists

A credential is a **capability**, not an **instruction**.

Before this switch existed, provider selection asked "is a key present?" and
treated the answer as permission to call a paid API. That meant dropping a key
into `.env.local` was enough to make every page render, every form submission
and every accidental refresh spend real money. Nobody had chosen that; it
happened because one question was being used to answer a different one.

Those are now two variables:

| Question | Answered by |
| --- | --- |
| *Are we allowed to call out?* | `MODEL_STUDIO_MODE` |
| *Could we, if we were allowed?* | `DASHSCOPE_API_KEY` + workspace/base URL |

Both must say yes.

---

## 2. The matrix

| | `disabled` (default) | `recorded` | `live` |
| --- | --- | --- | --- |
| Network | **Never** | **Never** | May call Model Studio |
| Credential read | No | No | Yes |
| Transport constructed | No | No | Yes |
| Understanding | Fixture | Stored artefact | Qwen |
| Research | Fixture | Stored artefact | Model Studio web |
| UI label | Demo fixture / Local fixture | Recorded Model Studio | Qwen live / Model Studio web live |
| Flight inventory | Local fixture | Local fixture | **Local fixture** |
| Demo works | Yes | Yes | Yes |

The flight row does not move. Phase 6 connected a language model and a web
search; it connected no airline, and no mode changes that.

### `disabled`

The default, and the state of a fresh checkout. The config reader returns before
it reads the key, so there is no transport and no request is constructible.
Every screen is served by fixture providers that label themselves as fixtures.

### `recorded`

Also never touches the network. Intended to serve sanitised structured results
captured from a real earlier call.

**No such recording exists yet.** Live extraction calls have been made, but none
has been sanitised and stored, and no research call has been made at all. Until
a recording exists, `recorded` behaves like `disabled` and the honest label is
the fixture one. A sanitised test fixture is *not* a recorded Model Studio
result, and this repository does not pretend otherwise.

### `live`

The only mode that may make an external call, and only when credentials are also
present and an operation explicitly asks for one. Page loads do not call
anything; the server actions behind the two Phase 6 forms do.

### `FAILED`

Not a configured mode but a runtime outcome, and the important one.

**A live call that fails stays failed.** It does not become a fixture answer
under a live label. Every failure has its own state and its own sentence on
screen — see `FAILURE_MODES.md`. Silent substitution is the single most damaging
thing this product could do in front of an audience, because nobody watching
could tell.

Likewise, `live` requested without a credential is reported as a failure naming
what is missing. It is never a quiet downgrade.

---

## 3. Rules the implementation guarantees

1. **Off by default.** Unset means `disabled`.
2. **Fails closed.** An unrecognised value — `on`, `true`, `enabled`, `LIVE!` —
   means `disabled`. The failure mode of a typo is a demo on fixtures, not a
   bill.
3. **Case and padding tolerant.** `  LIVE  ` works, because a human types it.
4. **The key is not read while the switch is off.** Nothing can leak from a code
   path that never touches it.
5. **Server-side only.** `MODEL_STUDIO_MODE` has no `NEXT_PUBLIC_` form, and no
   client component can reach the registry — `server-only` makes that a build
   error, and `tests/serverBoundary.test.ts` asserts it.
6. **Provider and mode travel together.** `resolveProviders` returns both, so a
   screen cannot take the provider without also taking what to call it.

---

## 4. Checking the current state

```bash
npm run preflight:model-studio
```

Offline, no secret in the output, exit 0 regardless. It reports the mode,
whether live is enabled, whether the endpoint is constructible, and — if not
ready — exactly which values are missing.

---

## 5. Mixed provenance is expected

There is deliberately **no global switch that makes the application live.**

Understanding and research have their own modes. Flight inventory is a local
fixture. Provider capacity is not connected. Assistance is confirmed by its
owner and by no operator. All five are true at once, and the subsystem board
renders all five rather than simplifying.

One "live" badge covering that set would be true of whichever part somebody is
looking at and false of the part they are about to trust. The Phase 5 global
banner was deleted rather than left available, because a ready-made one in the
codebase is an invitation to reintroduce the claim.

## The recorded fallback is now a real recording (22 Aug 2026)

`RECORDED_RESEARCH` previously held one hand-written scenario. It now also holds
`HAMARIKYU_ACCESS_LIVE`, transcribed from an actual Model Studio run: 54.2s, 6
sources, 12 claims, 0 rejected citations.

**Why it exists.** Live research succeeded in three of six live attempts (see
`QWEN_INTEGRATION.md` for the latency table). The failure is not recoverable by
waiting longer, and it is not a defect we can fix -- `web_extractor` requires
thinking mode, and thinking mode is the cost. A demo that needs to win a coin
flip on stage needs a fallback that does not.

**What was sanitised.** URLs, structured claims, and the relationships between
them. No page text, exactly as with every other fixture.

**What it may never do.** Claim to be live. The replaying provider reports
`RECORDED_WEB`, the UI renders that distinctly from `LIVE_WEB`, and
`tests/liveShapes.test.ts` asserts it explicitly. A recorded answer presented as
a live one would be the single most effective lie available to a demo, which is
why the assertion is written as a negative as well as a positive.

**The conflict in it is real.** The Tokyo metropolitan accessibility record
states four wheelchair-accessible restrooms; a community accessibility review
counts five. That disagreement was not manufactured for the fixture -- it is
what the web said on the day, and it is precisely the case the evidence layer
exists to surface rather than average away.

## ATLAS_MODE (Phase 7)

A second provider, the same shape as `MODEL_STUDIO_MODE`, deliberately -- a
different set of rules for the second integration would be one more thing to
reason about at exactly the wrong moment.

| Value | Behaviour |
|---|---|
| `disabled` (default) | The CLI is never started. |
| `recorded` | Replay a captured sandbox result. Never labelled live. |
| `sandbox` | Contact Atlas, after proving the environment. |

**There is no `production` value, and setting `ATLAS_MODE=production` yields
`disabled`.** Production is not disabled by configuration here; it is absent
from the type. Adding it would be a code review, not an environment variable.

Fail-closed on typos, same as Model Studio: `ATLAS_MODE=sandbx` is `disabled`.

### The sandbox proof runs before EVERY operation

Not once at startup. Atlas defaults to production and offers no command that
reads the current environment, so `proveSandbox` sets sandbox and reads the
confirmation back, immediately before each call. A read-then-act check would
leave a gap; this has none, and it can only ever move towards safety.

### No fallback, in either direction

An Atlas failure throws. It does not return mock offers, recorded offers, or an
empty list that reads like "no flights today". Switching to recorded data is a
decision made above the provider, explicitly, and it renders as the recorded row
it actually is.

## `ATLAS_MODE=recorded` is now real

`RecordedAtlasSandboxProvider` replays a genuine Atlas Sandbox search and
verification from 22 August 2026: two HKG-MNL offers, one direct and one
connecting, the first verified as unchanged at USD 101.29.

**It replays through the same parser and normaliser as the live path.** A
hand-built list of `FlightOffer` objects would keep working after a parser
regression, and the demo would look healthy while the real integration was
broken -- the exact failure a fallback exists to prevent, inverted.

**It takes no clock.** Every other provider does. This one has nothing to ask
one: a recording's timestamps are the ones it was recorded with, and the only
thing a current clock could do is make old data look newer. The absence of the
parameter is the guarantee.

**It never reports verified.** Atlas really did verify that offer -- in the past.
`verifyOffer` returns the recorded result as `RECORDED_ATLAS_SANDBOX` with no
`verifiedAt`, and the capability report says `verifyOffer: UNSUPPORTED`, so replay
cannot be mistaken for a freshness check.

**It answers only the route it holds.** A search for anywhere else returns
nothing rather than the wrong flights.
