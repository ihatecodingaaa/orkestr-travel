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

**No such recording exists yet**, because no live call has ever been made. Until
one does, `recorded` behaves like `disabled` and the honest label is the fixture
one. A sanitised test fixture is *not* a recorded Model Studio result, and this
repository does not pretend otherwise.

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
