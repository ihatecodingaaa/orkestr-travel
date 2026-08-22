# Security

**Status:** policy in force from Phase 0, and enforced by tests from Phase 6.
No credential exists in this repository. The application is now *capable* of
contacting Alibaba Cloud Model Studio, and has never done so.

## 1. Never commit

Atlas credentials. Alibaba Cloud keys. Qoder credentials. Hackathon mailbox
credentials. Passenger identities. Database credentials. Tokens of any kind.

`.gitignore` excludes `.env`, `.env.local` and `.env.*.local`.

From Phase 6 this is checked rather than trusted. `tests/serverBoundary.test.ts`
asserts that `DASHSCOPE_API_KEY` is read in exactly one module, that its value
is dereferenced in exactly one other, that no client component imports an
adapter or reads `process.env`, and that the built browser bundle contains
neither the variable name, nor the Model Studio host, nor the extraction system
prompt.

## 1a. Live calls have now been made

38 real requests have been made to Alibaba Cloud Model Studio from the
founder's machine, all extraction-only, all with fictional input.

No credential has entered this repository. The key lives in `.env.local`,
which is gitignored, is never read by any tool here except at run time, and is
inert unless `MODEL_STUDIO_MODE=live`. `npm run check:secrets` runs inside
`npm run verify` and fails the build if any of that stops being true.

No real personal data has been sent. Every evaluation discussion is invented.

## 1b. The secret gate

`npm run check:secrets` runs inside `npm run verify`, so a finding fails the
build before a push can happen. It is deliberately small and project-specific:
a generic scanner is either noisy enough to be ignored or quiet enough to miss
the one thing that matters.

It refuses: a tracked environment file; a `.gitignore` that has stopped
excluding `.env*`; a key-shaped literal with no marker proving it fake; a
`NEXT_PUBLIC_` secret; a hard-coded `Authorization: Bearer`; a populated
credential in a tracked file; and the credential being named in more than one
module.

It scans **tracked files only**. That is the correct scope, and it is also the
point: a safety tool that opens `.env.local` to check whether it is safe has
become the leak it was guarding against.

The repository convention it enforces: **any key-shaped string committed here
must contain a marker word proving it is fake** (`test`, `not-real`, `example`,
`never`, `redact`, and so on), so "is this real?" is answerable by reading the
string rather than by trusting whoever wrote it.

## 1c. External calls are off by default

`MODEL_STUDIO_MODE` decides whether anything external may be called, and
defaults to `disabled`. A credential is a capability, not an instruction.

Before this existed, a key in `.env.local` was enough to make every page render
and every accidental form submission spend real money. In `disabled` and
`recorded` the config reader returns before it reads the key at all, so there
is no transport and no request is constructible. An unrecognised value fails
closed. See `PROVIDER_MODES.md`.

## 2. The public-prefix rule

**A secret must never use the `NEXT_PUBLIC_` prefix.**

That prefix inlines the value into the browser bundle at build time. Anything
carrying it is published to every visitor, permanently, and rotating the key is
the only remedy. Only genuinely public configuration may use it.

A test scans every source file and `.env.example` for a `NEXT_PUBLIC_` variable
whose name contains KEY, SECRET, TOKEN, DASHSCOPE or WORKSPACE, and fails.

## 3. Environment template

`.env.example` contains **names and safe placeholders only**. Copy it to
`.env.local`, which is gitignored, and fill it in there.

Every integration is optional. Nothing in it is required to run the tests, the
production build or the demo: with the file empty, the application runs in
fixture mode and says so on every screen. "Not configured" is a state, not an
error, and the code treats it as one.

## 4. Personal data

Travellers supply names, dates, budgets, dietary requirements and assistance
needs. Assistance and dietary information is sensitive.

Rules:

- **Never log full passenger records.** Log identifiers, not payloads.
- **Never log a pasted discussion, or a model response.** From Phase 6,
  `src/adapters/diagnostics.ts` is the only module permitted to write a provider
  log line. It emits a request id, an operation, a provider, a model, a
  duration, token counts and item counts. Tests assert that a log line for the
  demo family contains none of "Tokyo", "Gita", "step-free", "600 SGD",
  "Ryan", "wheelchair" or "assistance".
- **Never log a research question's stated needs.** The question KIND is logged;
  the group's accessibility and dietary requirements are not.
- Every message that reaches a log passes through `redactSecrets`, in case a
  provider echoed a credential back inside an error.
- Private constraints are never attributed publicly. See Principle 8 in
  `PRODUCT_SPEC.md`.
- Age bands are person-supplied. They are never estimated, and never obtained
  from social media.
- User-shared links are stored as the user's input, not republished as claims.

## 5. Sandbox labelling

Sandbox and fixture data must always be **visibly labelled in the UI**, not only
in the data model. `SandboxOrderResult.isSandbox` is typed as the literal `true`,
so a production order cannot be returned by that code path without a deliberate
type change that a reviewer would see.

## 6. Provider safety

No test may call a paid or live API. Development uses the Atlas sandbox
exclusively. Production bookings are prohibited during development.

## 6b. The local interface

The Phase 5 screens make no network request of any kind. There is no analytics
SDK, no third-party tracking, no external font or image host, no QR service and
no telemetry, and that has not changed.

The Phase 6 screens make a network request only when a credential is configured
and only from the server, to Alibaba Cloud Model Studio. With no credential the
whole application still runs offline from recorded data, and says so.

There is **no authentication and none is implied**. The participant route says
plainly that it is not a private link. A capability URL that is not actually a
capability would be worse than making no claim at all, so the claim is not made.

Demo state lives in the URL, but an accepted compromise never does: an
acceptance is a real act by a real person, and putting it in a query parameter
would imply anybody holding the link had given it.

No real passenger data exists anywhere in the repository. Every identity in
every fixture is invented.

## 6c. Untrusted input, and server-side request forgery

**A pasted group discussion is untrusted data.** It may contain quoted
instructions, pasted JSON, fake system prompts, HTML and URLs. The system
prompt says so and the user message wraps it in a delimited block whose closing
marker is neutralised, but that is a mitigation and not the control. The control
is that an injected instruction the model obeys completely still cannot obtain
authority. See `QWEN_INTEGRATION.md` sections 6 and 7.

**A pasted URL is untrusted data.** A page-reading service pointed at
`http://127.0.0.1:6379` or `http://169.254.169.254/latest/meta-data/` is a
request made from inside the trust boundary on behalf of whoever pasted it.
`src/core/research/url.ts` refuses non-web schemes, loopback, private ranges,
carrier-grade NAT, link-local including the cloud metadata address, IPv6
equivalents, internal hostnames, embedded credentials and non-web ports —
**before any request is made**, because a rejection after the request has gone
out is not a rejection. 47 tests.

## 7. Separation from the startup repository

Orkestr Travel is a separate repository from the Orkestr startup (`orkestr_luc`),
which remains active rather than superseded. See `STARTUP_BOUNDARY.md`.

The startup repository holds live secrets in its own deployment environment,
including a testnet wallet key. **Nothing from that environment is copied here**,
and no credential is shared between the two projects. Credentials created for
hackathon services stay scoped to this repository and must not be introduced into
the startup's environment without a deliberate decision.

## Entity identity is not model-controlled (Phase 6.7)

A model that can name the entity a claim is about can attach a true statement to
the wrong thing, which is more dangerous than an obviously false statement:
every other integrity signal stays green.

The containment is that **the model cannot express identity at all**. It receives
a list of ids we issued, returns one of them or `null`, and any other string
resolves to `UNSPECIFIED`. There is no free-text subject channel, and the
research payload parser deliberately does not read a `subject` object even
though the internal type has one.

Tested directly (`tests/subjectBinding.test.ts`, case J):

* A claim whose statement instructs the reader to reassign every subject to the
  target venue, carrying an invented id -- resolves to `UNSPECIFIED`.
* A payload supplying a complete, well-formed `subject` object -- the parser
  does not read it.

Related: an unknown `subjectId` does not fall back to the fixture-only `subject`
field. A fallback there would be a bypass, not a convenience.

## The Atlas CLI boundary (Phase 7)

### Credentials are not ours to hold

The `atlas-flight` CLI owns its own secure store. This application never reads
it, never passes a token, and never puts one in a command argument. There is no
Atlas credential in `.env.local`, in source, in tests or in fixtures, and
nothing in the adapter looks for one.

`stderr` from the CLI is **counted, never kept**. It is diagnostic text from
somebody else's program and the most likely place for something we should not be
storing to appear; a byte count says "it spoke" without repeating what it said.
Malformed stdout is likewise refused without echoing it.

### Command injection

`spawn` with `shell: false` and an argument ARRAY. No code path in the adapter
builds a command string, so shell metacharacters have no meaning anywhere.

On top of that, request values are **allow-listed, not sanitised**: an airport
code must match `^[A-Z0-9]{3}$`. Allow-listing beats escaping because there is
no escaping to get wrong and a character nobody thought of is excluded by
default. Values are additionally refused if they contain a NUL byte or begin
with `-` -- a value like `--passengers-file` would silently become a FLAG and
change which command Atlas actually ran.

Validation happens before the process exists. `tests/atlasAdapter.test.ts`
asserts that a hostile origin starts no subprocess at all -- not even the
environment call.

Model output reaches this boundary the same way user input does and is held to
the same rule: Qwen proposes, deterministic validation decides, only then does
Atlas see anything.

### Production

Orkestr cannot select the production environment. The string appears in no
argument array it can build, there is no configuration value that produces one,
and `ATLAS_MODE` has no production variant. Asserted directly in tests.

### Passenger data

None. Phase 7 performs search and verification only, neither of which requires
passenger identity. The adapter cannot create an order, and `stdin` is closed on
every invocation, so there is no channel through which passenger data could
reach the CLI even by mistake.
