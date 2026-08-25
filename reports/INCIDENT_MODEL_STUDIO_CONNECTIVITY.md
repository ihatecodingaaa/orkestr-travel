# Incident Report — Alibaba Model Studio "connectivity" from production

**Status: RESOLVED. It was never a connectivity problem.**

Date: 25 August 2026
Repository: `C:\Users\lucas\Documents\orkestr-travel`
Starting commit: `6294885`
Ending commit: `d95c719`
Production: `https://orkestr-travel.vercel.app`, Vercel region `sin1`, Node v24.18.1

---

## 1. Executive verdict

The extraction deadline was **below the extraction workload, by four hundred
milliseconds**.

The request was aborted at 30,000 ms while the job genuinely takes 30,384 ms to
32,809 ms. Because a non-streaming completion sends no response headers until it
has a response to send, the abort produced the message *"The provider did not
answer at all within 30000ms"* — which reads like a network fault, and is not
one.

I previously reported this as a connectivity problem between Vercel and Model
Studio Singapore, and recommended it as a founder infrastructure action. **That
was wrong.** The network was healthy the whole time. The evidence that would
have contradicted me existed and I had not gathered it: I inferred from a single
absent number rather than testing the layer it supposedly implicated.

## 2. Root cause

`DEFAULT_TIMEOUT_MS` was 30,000 ms. The `/understand` payload — 763 characters
of discussion, plus a large system prompt — produces **1,650 to 1,859 output
tokens** of structured JSON at roughly 50 tokens per second.

There is no `max_tokens` (deliberately: capping output under structured output
truncates the JSON mid-object and reports as a model failure). So the generation
runs as long as the structure requires, and that is just over thirty seconds.

## 3. What the layers actually said

Every layer was proven **before** the timeout was touched, because raising a
ceiling over a broken connection only buys a slower failure.

Measured from inside a Vercel `sin1` production function:

| Layer | Workspace-dedicated | Shared `dashscope-intl` |
| --- | --- | --- |
| DNS | OK, 284 ms — **A=2, AAAA=0** | OK, 20 ms — **A=3, AAAA=0** |
| Address family selected | IPv4 | IPv4 |
| TCP :443 | OK, 4 ms | OK, 13 ms |
| TLS (SNI, verified) | OK, 13 ms, TLSv1.3 | OK, 16 ms, TLSv1.3 |
| HTTP (unauthenticated `GET /models`) | **401 in 30 ms** | **401 in 45 ms** |

Local control, same probe: both hosts IPv4-only, TLSv1.3, 401 in 56–70 ms.

**Both endpoints reach HTTP.** By the incident brief's own interpretation table
that means the network path is healthy and the question moves to authentication
and the request layer.

`rejectUnauthorized` stayed `true` throughout. A probe that weakens verification
to "get further" answers a question nobody asked.

## 4. Credential and IP allowlist

**No founder dashboard check was needed.** The question was answerable for free
and was answered:

```
authenticated GET /models, from Vercel production
  status 200, headers at 37 ms
```

**HTTP 200.** The credential is accepted from Vercel's egress address. A
source-IP restriction would have produced 403 from this runtime, whose outbound
addresses are dynamic. It did not.

So: **API key permission finding — no restriction in evidence. IP allowlist
finding — none.** No static-egress purchase, no Vercel Pro, no Alibaba gateway,
and no PrivateLink is warranted. None of §16's options apply.

## 5. Environment and URL construction

All correct, verified from the production runtime without printing any value:

| Variable | Finding |
| --- | --- |
| credential | present |
| `MODEL_STUDIO_WORKSPACE_ID` | present, non-empty, **no stray whitespace** |
| `MODEL_STUDIO_REGION` | `ap-southeast-1` |
| `MODEL_STUDIO_MODE` | `live` |
| `QWEN_EXTRACTION_MODEL` | `qwen3.7-plus` |
| `DASHSCOPE_BASE_URL` | present but **empty** — correctly treated as unset |

The request URL resolves to
`https://<workspace>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions`
— no duplicated `/v1`, no doubled separator, no DashScope-native path, no
encoded braces. `readEnv` already trims, so a value pasted with a trailing
newline cannot malform the hostname; this is now asserted by tests rather than
assumed.

**No new environment variable was added.** Selecting Alibaba's shared Singapore
endpoint needs none: `DASHSCOPE_BASE_URL` already does it, and a test proves it.

## 6. The paid calls

Four, each deliberate:

| # | Where | What | Result |
| --- | --- | --- | --- |
| 1 | Production | minimal completion, 16 tokens, thinking off | **200 in 1,300 ms**, replied "OK" |
| 2 | Production | real `/understand` extraction, old ceiling | timed out at 30,005 ms |
| 3 | Local | `/understand` payload, generous 170 s cap | **30,384 ms**, 1,650 output tokens |
| 4 | Local | same, with failure code printed | **32,809 ms**, 1,859 output tokens |

Plus one verification run after the fix (§9). All connectivity and credential
work was free — no inference — and can be repeated at no cost.

Call #1 is the one that broke the case open: **the same endpoint, same runtime,
same model, same `enable_thinking: false`, answering in 1.3 seconds.** That is
incompatible with a broken network and compatible only with a long generation.

## 7. Retries, cold start, region, timeout

* **Retries: none, anywhere in the Model Studio path.** Audited: a single
  `fetch`, no SDK, no manual retry, no fallback endpoint. The only `mayRetryOnce`
  in the repository belongs to the Atlas adapter and is unrelated. A timeout
  cannot produce duplicate billable requests.
* **Cold start: not a factor.** Free network probes were repeated across cold and
  warm functions; DNS on a cold function was 284 ms against 20 ms warm, so the
  first-call overhead is a fraction of a second, not twenty.
* **Region: confirmed `sin1`**, `VERCEL_ENV=production`, beside Model Studio
  `ap-southeast-1`. No region change was made or is warranted.
* **Timeout: raised, with evidence, and only after the layers beneath it were
  proven.** 30,000 ms → **50,000 ms** — about 1.5× the slowest measured run.

## 8. The fix, and why this one

```
DEFAULT_TIMEOUT_MS   30_000 → 50_000
app/understand/page.tsx   export const maxDuration = 60
```

The second half matters as much as the first. A server action is killed by the
platform at its own ceiling, so a function that outlives the deadline it
contains is the difference between the product's honest sentence and a platform
error page. Next's docs are explicit that `maxDuration` must be set at the
**page** level to govern the server actions used on it.

Two tests assert the relationship rather than describing it: the ceiling must
exceed the slowest measured run with real margin, and it must fit inside the
declared function lifetime. Restoring a round thirty seconds now fails a test.

**No fallback architecture is needed.** No shared-endpoint fallback was
implemented, because the dedicated endpoint was never the problem — implementing
one would have been a workaround for a fault that did not exist. §17's Alibaba
Function Compute gateway is not warranted.

## 9. Verification

One real `/understand` extraction against production, after redeploy:

```
wall clock                 33,399 ms
provider                   32,531 ms   2,291 in / 1,850 out tokens
POST /understand           200 in 32,591 ms
```

**The call now completes.** It is no longer aborted, and the provider's real
token counts are reported. The timeout root cause is fixed and verified in
production.

## 10. What this did NOT fix — a separate, pre-existing defect

**`/understand` still does not succeed end to end, and the reason is unrelated
to this incident.**

With a generous cap the call completes and is then refused:

```
code     SEMANTIC_VALIDATION_FAILED
path     constraints[0].source.quote
detail   The supporting quote does not appear in the supplied discussion,
         so the proposal has no traceable basis.
problems 5
```

The model is inventing supporting quotes for this discussion, and the
quote-traceability guard is **correctly** declining them. The guard already
normalises case, whitespace, curly quotes and dashes, so this is not a
punctuation mismatch — the quoted words are not in the text.

This is the anti-hallucination guard doing its job. It is also a real product
defect, because it fires on the product's own showcase discussion. It is a
prompt/model-quality problem requiring paid iteration, it is out of scope for a
connectivity incident, and it is recorded here rather than quietly bundled into
the fix.

The consumer sees an honest, non-technical sentence:

> **The reading did not match what you pasted.** Something in the reply referred
> to a person or a quote that is not in the text you gave us.

Nothing is applied, and nothing invented is shown.

## 11. Error taxonomy

The transport already distinguishes `TIMEOUT`, `NETWORK`, `HTTP_ERROR` and
`MALFORMED_RESPONSE`, and — since the previous investigation — separates *"did
not answer at all"* from *"answered after N ms but did not finish"* via
`headersAtMs`.

That distinction is what made this diagnosable, and it is also what I
**misread**: an absent `headersAtMs` means the response never *started*, which
for a non-streaming completion means generation never *finished*. It does not
mean the network failed. The wording now has a control proving it: an
authenticated request with nothing to generate returns headers in 37 ms.

The network-level codes (`DNS_FAILED`, `CONNECT_FAILED`, `TLS_FAILED`,
`NO_HEADERS_TIMEOUT`) live in the layered probe, which is where they can
actually be determined. A larger enum in the transport would have been
complexity for its own sake: `fetch` cannot distinguish those causes, which is
precisely why the probe exists.

## 12. Tools left behind

Both opt-in, outside `verify`, and free:

```bash
npm run connectivity:model-studio   # DNS, TCP, TLS, HTTP + credential, both hosts
npm run timing:understand           # times the real payload with a generous cap
```

The temporary production route was **deleted**. It was never public — it
required a 256-bit token whose SHA-256 was all that lived in the repository, and
it returned 404 without it — and it took no target from the caller, so it could
not scan anything. Confirmed removed: production returns 404.

## 13. Corrections to earlier documents

`reports/STAGE_4_REPORT.md` §12 and the Stage 4 section of
`docs/IMPLEMENTATION_STATUS.md` recorded this as a Vercel↔Alibaba connectivity
fault requiring founder infrastructure work. Both are corrected in the same
commit as this report. The claim was wrong, it was mine, and it sent an
investigation after a fault that did not exist.

## 14. Final Model Studio status

**Reachability, credential and inference from production: LIVE VERIFIED.**
DNS, TCP, TLS, an authenticated listing request and a real `qwen3.7-plus`
completion all succeed from the deployed runtime, and the real extraction now
runs to completion in ~32.5 s.

**`/understand` end to end: BLOCKED** — `SEMANTIC_VALIDATION_FAILED`, the model
invents supporting quotes and the traceability guard refuses them. Separate
defect, recorded in §10, not fixed here.

## 15. Known limitations

1. **A 32-second wait is a poor experience** even though it now succeeds. The
   honest fix is a smaller structured output or streaming, not a larger number.
   Out of scope here; worth its own piece of work.
2. **50 s sits under a 60 s platform ceiling.** There is no room for a much
   larger ceiling on this plan, so a slower run still fails — correctly, and with
   an honest message.
3. **The measurements are a small sample** — four extraction runs, spanning
   15.6 s to 32.8 s. The spread is roughly 2×, which is why the margin is 1.5×
   rather than 1.1×.
4. **The quote-traceability failure was seen on one discussion.** Whether it
   affects arbitrary user text is not established.
