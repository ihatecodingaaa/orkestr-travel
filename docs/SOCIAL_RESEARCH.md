# Social Research

**Status:** `PLANNED` (Phase 6). Interface exists in `src/domain/research.ts`.
Nothing is implemented and no provider is contacted.

## 1. What is planned

Two providers:

- **QwenWebResearchProvider** using Alibaba Model Studio web search and
  extraction, when enabled.
- **UserSharedLinkProvider** for links a user gives us directly.

## 2. What is explicitly not planned

**No direct scraping of TikTok, Instagram or Reddit.** No dependence on
restricted research APIs. Those platforms are reachable only through content a
user chooses to share with us, or through a sanctioned search interface.

This is a deliberate product decision, not a limitation to work around.

## 3. User-shared content

A user may share a TikTok, Instagram post, Reddit thread, YouTube video, blog,
map link or article.

The content is **not** treated as truth. What is extracted is what the person
seems interested in.

```
User shares a night-market video
   -> inferred interest: "night-market food experience"
   -> status: INFERRED
   -> confirmed only if and when it matters to a decision
```

Sharing a link is not the same as asking for a thing. Treating it as such is how
an itinerary fills up with activities nobody actually requested.

## 4. Age-aware research

Reviewers' ages are never classified. Instead, queries are built from what the
group has actually stated about itself, for example:

- "family Tokyo itinerary with teenagers"
- "wheelchair accessible attraction Tokyo"
- "activities for multigenerational family Tokyo"
- "large group restaurant Tokyo"

## 5. Summaries

A community summary states the topic, the real number of sources considered, the
recency of those sources, common positives, common negatives, genuine
disagreements, and the source links. See `EVIDENCE_MODEL.md` for the rules on
what community evidence may and may not establish.
