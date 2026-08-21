# Social Research

**Status:** `IMPLEMENTED` (`src/adapters/modelStudio/qwenWebResearch.ts`,
`src/adapters/modelStudio/sharedLinkReader.ts`, `src/core/research/`), with the
live-call caveat in `IMPLEMENTATION_STATUS.md`.

## 1. What research actually is here

Not "go and look up Tokyo". A **typed, bounded question** with a stated purpose,
a stated source budget and a stated deadline.

An open-ended instruction to a model holding a search tool is an unbounded
spend, an unbounded wait and, worse, an unbounded claim: "we researched this
thoroughly" is not something the system can honestly say about an operation
whose size it did not control.

`ResearchQuestionKind` covers the cases the product actually consumes:
`OFFICIAL_ACCESSIBILITY`, `AIRPORT_PRE_FLIGHT`, `POST_FLIGHT`,
`LARGE_GROUP_DINING`, `COMMUNITY_ACTIVITY_SIGNAL`, `MULTIGENERATIONAL_ACTIVITY`,
`TEEN_INTEREST`, `DIETARY_FIT`, `DESTINATION_ACTIVITY`. A kind with no consumer
would be a question nobody reads, paid for per call.

Each question carries the destination, the group size, the age mix **only where
travellers volunteered it**, explicit interests, explicit accessibility needs,
pace, time window, source preference and a hard source ceiling.

## 2. How it is done

Alibaba Cloud Model Studio's Responses API with the built-in `web_search` and
`web_extractor` tools. Source URLs are read out of the provider's own tool-call
output, never out of the model's prose. See `QWEN_INTEGRATION.md` section 8.

`code_interpreter` is not enabled. Nothing in travel-source research needs to
run code.

## 3. What is explicitly not done

**No TikTok API. No Instagram API. No Reddit API. No scraper. No browser
automation.** There are no platform credentials anywhere in this project.

Community material reaches Orkestr through exactly two routes:

1. Public web search through the provider.
2. A public link a person chose to share with us.

This is a deliberate product decision, not a limitation being worked around.

**No document, screen or narration may say "Orkestr researches TikTok
directly."** What can honestly be said is that a user may share a public TikTok
link, and Orkestr will try to read that page through the provider's extractor
and will say plainly when it cannot.

## 4. User-shared links

A person may share a TikTok, Instagram post, Reddit thread, YouTube video, blog,
map link or article.

The URL is checked **before any request is made** — that ordering is the
control, because a rejection after the request has gone out is not a rejection.
See section 6.

The content is **not** treated as truth. What is extracted is at most a reading
of what the person seems interested in:

```
User shares a night-market video
   -> inferred interest: "night market food"
   -> status: INFERRED
   -> confirmed only if and when it matters to a decision
```

Sharing a link is not the same as asking for a thing. Treating it as such is how
an itinerary fills up with activities nobody actually requested.

## 5. Failing to read a page is a normal outcome

Plenty of social pages will not be publicly extractable. That is legitimate, not
an error to route around.

The state is `EXTRACTION_UNAVAILABLE`, the interface says:

> We could not read this page automatically. That is normal for some sites, and
> nothing about its contents has been guessed.

and then asks:

> **Why did you save it?**

Their sentence is better evidence of what they want than anything that could
have been guessed from the page anyway. There is deliberately no fallback that
derives an interest from the URL: a guess made from a hostname would be
indistinguishable, on screen, from something the page actually said.

## 6. URL safety

Validated in `src/core/research/url.ts` before anything is requested, with 47
tests in `tests/urlSafety.test.ts`.

Refused: `file:`, `data:`, `javascript:` and every other non-web scheme;
localhost and every loopback spelling; `0.0.0.0/8`; all three private IPv4
ranges; carrier-grade NAT; link-local, including the `169.254.169.254` cloud
metadata address by name; IPv6 loopback, link-local, unique-local and
IPv4-mapped loopback; internal hostnames and suffixes (`.local`, `.internal`,
`.corp`, `.home.arpa`); bare hostnames with no dot; credentials embedded in the
URL; and any port a public page is not served on.

Only external http and https URLs on ordinary web ports get through, and a
refused URL is never rendered as a clickable link.

## 7. Extract first, search second

User-shared content is read **before** any web search runs. A user who has
already handed us the page they care about should not have us go looking for it,
and every search not made is a call not spent and a claim not invented.

This is the same Principle 1 that governs extraction: use what has already been
said before asking anything.

## 8. Age-aware curation

**Age is context, not destiny.**

Queries are built from what the group has actually stated about itself. Where age
bands were volunteered, they are passed as a **count** — "1 older adult, 4
adults, 1 teen, 1 child" — immediately followed by an explicit instruction:

> Use this only to check that everybody could take part. Do not infer anybody's
> interests from it.

The system prompt separately forbids inferring interests from age, inferring an
accessibility need from age, and guessing the age of the people who wrote the
sources. Stated interests are placed **before** the age mix in the instruction
and are labelled "these matter most". `tests/prompts.test.ts` asserts all of it,
including the ordering.

A teenager is not assumed to want one thing and an older adult another.

## 9. Bounds

Four questions per run, five sources per question, six extracted pages, eight
provider calls, 45 seconds. Hitting a bound produces `RESEARCH_LIMIT_REACHED`
and the interface says the result is partial rather than presenting it as
complete.

No crawling. No recursive link following. No open-ended autonomous browsing.

## 10. Summaries

A community summary states the topic, the **real** number of sources actually
read, the recency of those sources, common positives, common negatives, genuine
disagreements, and the source links. The count comes from the ledger, never from
the model.

See `EVIDENCE_MODEL.md` for what community evidence may and may not establish.
