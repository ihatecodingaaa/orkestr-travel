# Security

**Status:** policy in force from Phase 0. No credential exists in this repository
and no external service is contacted.

## 1. Never commit

Atlas credentials. Alibaba Cloud keys. Qoder credentials. Hackathon mailbox
credentials. Passenger identities. Database credentials. Tokens of any kind.

`.gitignore` excludes `.env`, `.env.local` and `.env.*.local`.

## 2. The public-prefix rule

**A secret must never use the `NEXT_PUBLIC_` prefix.**

That prefix inlines the value into the browser bundle at build time. Anything
carrying it is published to every visitor, permanently, and rotating the key is
the only remedy. Only genuinely public configuration may use it.

## 3. Environment template

`.env.example` contains **names and safe placeholders only**. It currently
documents variables for integrations that do not exist yet, so that the security
boundary is defined before any credential is created rather than after.

Every integration defaults to off. Nothing is required to run the tests.

## 4. Personal data

Travellers supply names, dates, budgets, dietary requirements and assistance
needs. Assistance and dietary information is sensitive.

Rules:

- **Never log full passenger records.** Log identifiers, not payloads.
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

## 7. Prior-repository note

Orkestr Travel is a separate repository from Orkestr 1.0. The earlier project
holds live secrets in its own deployment environment, including a testnet wallet
key. **Nothing from that environment is copied here**, and no credential is
shared between the two projects.
