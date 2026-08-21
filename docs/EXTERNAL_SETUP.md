# External Setup

The runbook for connecting this project to the outside world. Nothing here has
been done yet except GitHub.

**No secret appears in this file, and none ever should.** Credentials live in
`.env.local`, which is gitignored and which no tool in this repository reads
except at run time.

---

## 1. Current external state

| Service | State | What that means |
| --- | --- | --- |
| GitHub | **CONFIGURED** | `origin` is `ihatecodingaaa/orkestr-travel`; pushes authorised |
| Alibaba Cloud | **NOT CONFIGURED** | No account action taken |
| Model Studio | **NOT CONFIGURED** | No key, no workspace, **no call ever made** |
| Atlas | **NOT CONFIGURED** | No credential, no code, no endpoint contacted |
| Vercel | NOT CONFIGURED | No deployment of any kind |
| Neon / Railway / Koyeb | NOT CONFIGURED | No database, no hosting |
| AgentRun / Function Compute | NOT CONFIGURED | No runtime provisioned |
| DNS | NOT CONFIGURED | |
| Database | NONE | No persistence anywhere in the product |

Check the Model Studio row yourself at any time, offline:

```bash
npm run preflight:model-studio
```

It makes no network request, prints no secret, and exits 0 whether or not
anything is configured — because an unconfigured checkout is a working
checkout, not a broken one.

---

## 2. Alibaba Cloud / Model Studio

### What you need at the end

Three values in `C:\Users\lucas\Documents\orkestr-travel\.env.local`:

```
MODEL_STUDIO_MODE=live
DASHSCOPE_API_KEY=<your key>
MODEL_STUDIO_WORKSPACE_ID=<your workspace id>
```

`MODEL_STUDIO_REGION` defaults to `ap-southeast-1` (Singapore) and the model
defaults are already correct, so those two lines are optional.

**`MODEL_STUDIO_MODE=live` is required.** Without it the key is inert: the
config reader returns before it reads the key at all. That is deliberate — a
credential should not be able to start spending money just by existing.

### Steps

1. Sign in to Alibaba Cloud with the hackathon account.
2. Choose the **Singapore** region. This build defaults to `ap-southeast-1`, and
   a workspace in another region needs `MODEL_STUDIO_REGION` set to match.
3. Open Model Studio and activate it if the console asks you to.
4. Find your **workspace** and note its ID. The console shows this on the
   workspace details view; it typically looks like `llm-xxxxxxxx`.
5. Create an **API key** in Model Studio.
6. Create `.env.local` at the repository root with the three values above.
   Copy `.env.example` if you want the full annotated list.
7. `npm run preflight:model-studio` — expect **Ready for live verification: YES**.
   If not, it names exactly which value is missing.
8. `npm run smoke:model-studio` — one tiny fictional request. Prints a safe
   summary only.
9. `npm run eval:qwen` — 17 fictional evaluation cases.
10. Then the research operations: one Responses API request, one bounded
    `web_search`, one `web_extractor` call.
11. **Update `IMPLEMENTATION_STATUS.md` only for the paths that actually ran.**
    If search works and extraction does not, record that split rather than one
    broad claim.

> The console's exact labels are not reproduced here, because they have not been
> verified from this session and a confidently wrong instruction is worse than a
> vague one. Follow the console; the four things you need are region, workspace,
> key, and Model Studio being active.

### Cost

`smoke:model-studio` is one small request. `eval:qwen` is 17. Research calls use
web search and page extraction, which cost more than plain completions. All of
them are bounded — see `PROVIDER_MODES.md` — and none of them runs as part of
`npm test`, `npm run check` or `npm run verify`.

---

## 3. Atlas

Nothing about Atlas has been verified, and this project deliberately contains no
Atlas code, no endpoint and no guessed payload shape.

1. Obtain hackathon or sandbox access.
2. Read the **actual** API documentation. Do not proceed from assumptions about
   what a flight API usually looks like.
3. Work through the readiness questions in `ATLAS_INTEGRATION.md`. They are
   questions, not a specification, and they exist so Phase 7 starts from
   verified facts.
4. Configure credentials locally, sandbox only.
5. Run one real search.
6. Verify one real offer.
7. **Only then** begin Phase 7 implementation behind the existing
   `FlightProvider` boundary.

---

## 4. What must never happen

- **No production booking.** Sandbox only, throughout development.
- **No credential in the repository.** `npm run check:secrets` runs inside
  `npm run verify` and fails the build on a tracked env file, a key-shaped
  literal, a `NEXT_PUBLIC_` secret or a hard-coded Authorization header.
- **No `NEXT_PUBLIC_` prefix on anything secret.** That prefix inlines the value
  into the browser bundle at build time; rotation becomes the only remedy.
- **No infrastructure provisioned without explicit founder approval.** See
  `ALIBABA_CLOUD.md`.
- **No claim that something is verified because its code exists.** The whole
  point of the preflight and smoke commands is that "it should work" and "it
  worked" are different statements.
