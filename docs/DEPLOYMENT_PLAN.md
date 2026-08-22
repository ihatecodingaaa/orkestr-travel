# Deployment plan

**Nothing has been deployed. This is a recommendation for the founder to decide on.**

No hosting provider, DNS record, domain, environment variable or database was
touched in producing it.

---

## The finding that makes this easy

**The application deploys and runs correctly with zero credentials.**

That is not a happy accident — it falls out of the kill switches. `MODEL_STUDIO_MODE`
and `ATLAS_MODE` both default to `disabled`, and both were built so that a
missing credential produces a *labelled fixture*, never a crash and never a
silent pretence.

Verified against a real production build and server, every route returning 200
with no `.env.local` present:

| Route | Status | What it needs |
|---|---|---|
| `/` | 200 | nothing |
| `/demo` · `/demo/waves` · `/demo/journey` · `/demo/decisions` | 200 | nothing |
| **`/demo/agent`** (the hero) | 200 | nothing |
| `/demo/agent?stage=RYAN_JOINED&fare=…` | 200 | nothing |
| `/understand` | 200 | nothing (fixture mode without a key) |
| `/research` | 200 | nothing (fixture mode without a key) |

## The Atlas question, answered

**The Atlas CLI is unreachable from any application route.** Verified by grep:
nothing under `app/` or `src/ui/` imports `atlasFlightProvider`,
`ChildProcessCliRunner` or `node:child_process`.

The hero page imports exactly one thing from the Atlas adapter — the
`RECORDED_AT` constant and the recorded fixture — and that path is pure: it
reaches `offerShape.ts` and `normalise.ts`, neither of which touches a process.

This matters because the live Atlas integration **cannot** work in a serverless
deployment, and should not be made to:

* The `atlas-flight` CLI is a Python tool installed via `uv`.
* It authorises through a **browser flow** and stores credentials in the
  operating system's secure store.
* Making that work on a serverless host would mean exporting a credential out of
  a secure store and into a hosting provider's environment — which is exactly the
  thing the credential boundary exists to prevent.

**So: do not try.** The live Atlas proof is a *local* capability, demonstrated on
this machine and recorded. The deployed application serves the recorded result
and says `RECORDED ATLAS SANDBOX` on screen. That is both the reliable choice and
the honest one.

## The Model Studio question, answered

| Variable | Required to deploy? | Effect if unset |
|---|---|---|
| `MODEL_STUDIO_MODE` | No | Defaults to `disabled`; understanding and research serve fixtures, labelled |
| `DASHSCOPE_API_KEY` | No | Never read unless mode is `live` |
| `MODEL_STUDIO_WORKSPACE_ID` | No | Same |
| `MODEL_STUDIO_REGION` | No | Defaults to `ap-southeast-1` |
| `QWEN_EXTRACTION_MODEL` · `QWEN_RESEARCH_MODEL` | No | Sensible defaults |
| `MODEL_STUDIO_TIMEOUT_MS` | No | 30000 |
| `ATLAS_MODE` | No | Defaults to `disabled` |

**Names only. No values appear in this repository, and none should be pasted
anywhere.**

If the founder later wants `/understand` to run live Qwen on the public site,
that needs `MODEL_STUDIO_MODE=live` plus the key and workspace id set as
**server-side** variables. Never with a `NEXT_PUBLIC_` prefix — that inlines the
value into the browser bundle at build time.

**Recommendation: leave it disabled publicly.** A public form that spends money
on every submission is a bill waiting to happen, and the live proof already
exists in the repository's evidence.

## Options, ranked

### Option A — Vercel *(recommended)*

Next.js 16 on its first-party host. Zero configuration, zero secrets, and the
build is already proven green.

| | |
|---|---|
| Demo reliability | **High** — no network dependency at runtime |
| Judge credibility | **High** — a working URL anyone can click |
| Setup risk | **Low** — no env vars to get wrong |
| Time | Minutes |
| Recorded hero | Yes |
| Live Model Studio | Possible, not recommended |
| Live Atlas | **No** — and should not be attempted |

### Option B — Alibaba Cloud runtime

Thematically appropriate for an Alibaba Cloud hackathon, and worth a sentence in
the submission if it is done.

| | |
|---|---|
| Demo reliability | High, once configured |
| Judge credibility | **Highest** — running on the sponsor's own cloud |
| Setup risk | **Medium** — a new runtime to configure under time pressure |
| Time | Hours, realistically |
| Live Atlas | **No**, same CLI limitation |

### Option C — Local only, no public URL

| | |
|---|---|
| Demo reliability | High — it is the recording machine |
| Judge credibility | **Lower** — nothing to click |
| Setup risk | None |

**Ranking: A, then B, then C.** Option B is more impressive *if* there is time to
spare; Option A is the one that cannot go wrong. Under deadline pressure,
reliability beats thematic fit — a broken sponsor deployment is worse than a
working neutral one.

A deployed URL may not even be required; the submission form asks for a YouTube
link. Treat deployment as credibility, not as a dependency.

## Commands

```bash
npm ci
npm run build      # next build
npm run start      # next start, Node >= 20
```

No build-time secret. No postinstall step. No filesystem writes at runtime.

## Post-deploy smoke test

Six clicks, no credentials:

1. `/` loads and the provenance board shows mixed sources, not one "LIVE" badge.
2. `/demo/agent` loads and reads *"Nothing has changed yet"*.
3. **Ryan joins** → what changed / what it affected / what stayed the same.
4. Preservation reads **10 of 10**, note says nothing agreed had to be undone.
5. **Check the fares** → the run becomes *Needs one person's decision*, not a success.
6. **Reset** → back to the exact starting state.

Then: open the browser console and confirm there are no errors, and open the
network tab and confirm **no outbound provider request fires**.

## Rollback

The application is stateless — no database, no persistence, no migrations.
Rollback is redeploying the previous commit. There is nothing to restore.

## What must never be done

* Export an Atlas credential out of the OS secure store into a hosting provider.
* Put any secret behind `NEXT_PUBLIC_`.
* Set an `ATLAS_MODE` of `production`. It does not exist, and adding it would be
  a code change requiring review.
* Claim on the deployed site that sandbox fares are real prices.
