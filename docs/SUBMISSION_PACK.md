# Submission pack

**Nothing here has been submitted.** This is the content, ready for the founder
to review and send.

---

## Project title

**Orkestr Travel**

## One-sentence description (100-character limit)

Character counts verified programmatically.

| # | Option | Chars |
|---|---|---|
| **1** *(recommended)* | `Orkestr repairs group trips when people, plans or prices change—without restarting everything.` | **94** |
| 2 | `Orkestr coordinates group trips and repairs only what changes, instead of rebuilding the trip.` | 94 |
| 3 | `A coordination agent for group travel: it repairs what broke and keeps everything else intact.` | 94 |
| 4 *(shortest)* | `Orkestr coordinates group journeys and repairs only what actually changed.` | 74 |

Option 1 leads with the pain and names the differentiator in the same breath.

## 30-second description

Group trips break for boring reasons: people are free on different days, budgets
are private, someone joins late, a fare moves. Most travel AI treats this as a
search problem and regenerates the whole itinerary whenever anything changes,
throwing away every decision the group already agreed to.

Orkestr treats it as a coordination problem. It reads the group's messy
conversation with Alibaba Cloud Model Studio, splits people into Travel Waves by
confirmed availability, builds one journey with a reunion point, and verifies
flight facts against Atlas. When something changes it works out exactly what
broke, repairs only that, checks the result actually holds, and stops — telling
you what it did not touch.

## One-paragraph description

Orkestr Travel is a coordination agent for group journeys. Where most travel AI
helps one person build an itinerary, Orkestr handles a group with conflicting
dates, budgets and access needs — splitting them into Travel Waves when no single
flight works, tracking when everyone is finally together, and keeping private
constraints private. Its distinguishing behaviour is repair: when a traveller
joins late or a fare moves, it identifies the affected part of the journey,
re-verifies stale provider facts, changes only what broke, validates that the
result is still a valid trip, and reports exactly how many earlier decisions
survived. The agent is bounded by a hard step limit and never reports success it
has not verified. Alibaba Cloud Model Studio provides language understanding and
evidence research; Atlas provides flight search and fare verification; every
consequential decision — money, feasibility, group splits, repair — is made by
deterministic code, not by a model.

---

## Three-minute video

Target **2:45–2:55**. Hard limit 3:00.

### Storyboard

| Time | On screen | Beat |
|---|---|---|
| 0:00–0:15 | Title / group chat | The problem |
| 0:15–0:35 | `/understand` | Messy conversation → understanding |
| 0:35–0:55 | `/demo/waves` | Constraints → Travel Waves |
| 0:55–1:10 | `/demo/journey` | Journey + reunion |
| 1:10–1:25 | `/` provenance board | Model Studio + evidence |
| 1:25–1:40 | `/demo/agent` provider card | Atlas proof |
| 1:40–1:55 | Click **Ryan joins** | The change |
| 1:55–2:20 | `/demo/agent` | **What changed / affected / stayed** |
| 2:20–2:38 | **Check the fares** → participant view | Private decision |
| 2:38–2:52 | `/demo/agent` numbers | Preserved + bounded run |
| 2:52–3:00 | Close | Closing line |

### Narration — 390 words

> Planning a group trip isn't a search problem. It's a coordination problem.
>
> Seven people want to go to Tokyo. Grandma can only fly Tuesday. Ryan can only
> fly Wednesday. One person uses a wheelchair. One has a budget they'd rather not
> announce to the group chat. And when any of that changes, most travel tools
> throw the whole itinerary away and start again.
>
> This is Orkestr.
>
> It reads the group's actual conversation using Alibaba Cloud Model Studio. Not
> a form — the messy version, the way people really talk. Everything it extracts
> stays a *proposal* until the person it belongs to confirms it.
>
> Then the deterministic part takes over. No single flight works for everybody,
> so Orkestr splits the group into Travel Waves — by confirmed availability, not
> by asking a model what it thinks. A Tuesday group and a Wednesday group. It
> also knows the group isn't actually together until the second wave lands, so
> anything for everyone sits after that reunion point.
>
> Research comes from Model Studio too, and every claim cites a page that was
> genuinely fetched. Official sources and community opinion are never mixed up.
>
> For flights, Orkestr connects to Atlas. This is a recorded Atlas Sandbox search
> and verification — Hong Kong to Manila — so the demo doesn't depend on an offer
> that expires in fifteen minutes. Sandbox fares are test data. Notice it doesn't
> just search: it re-checks the fare before relying on it.
>
> Now watch what happens when something changes.
>
> Ryan joins, a week late, after everything was agreed.
>
> Orkestr doesn't rebuild the trip. It works out what this actually affects — the
> Wednesday group — and tells you what stayed exactly as it was. The Tuesday
> group. The reunion. The return flight.
>
> Ten of ten earlier decisions kept. Nothing already agreed had to be undone. One
> new decision added: Ryan's.
>
> Now the fare moves. It's above one traveller's private budget — so Orkestr asks
> that one person, privately. Not the group. Not the organiser. Their constraint,
> their decision.
>
> And when it's done, it tells you why it stopped. Five steps of a hard limit of
> seven. Zero whole-trip rebuilds. Zero AI calls during the repair itself,
> because AI proposes and code decides.
>
> If it can't verify the result, it says so — it never reports success it hasn't
> checked.
>
> Travel together, even when you can't travel the same way.

### Notes for delivery

* The first fifteen seconds must land the problem. Don't explain architecture.
* Slow down for **"what stayed exactly as it was"**. That is the whole product.
* Say **"sandbox"** and **"recorded"** out loud where they appear.
* Don't read the screen. Let the numbers sit.

---

## Technical proof

* **Alibaba Cloud Model Studio, live-verified**: structured intent extraction,
  Responses API, `web_search`, `web_extractor`, and entity-bound research claims
  where a source about one venue cannot clear a requirement for another.
* **Atlas, live-verified**: sandbox search and offer verification against the
  real `atlas-flight` CLI, with the sandbox environment re-proven before every
  single call because Atlas defaults to production.
* **1,146 automated tests across 55 files**, no network access required.
* **Bounded agent**: one step-counting site, no recursion, and
  `STEP_LIMIT_REACHED` is a distinct terminal state that never becomes success.
* **Postcondition checking**: a repair engine reporting success is not the same
  as a valid journey, and the two are checked separately.
* **Exact money**: integer minor units throughout, with a real float artifact in
  the live Atlas payload (`135.73 × 100 = 13572.999999999998`) pinned by test.

## Alibaba Cloud usage

Model Studio (Qwen) does two jobs: reading the group's conversation into
structured proposals, and bounded web research with real citations. Both are
live-verified. Neither decides anything consequential — proposals await their
owner's confirmation, and research claims are bound to a specific entity before
they can clear anything.

## Atlas usage

Flight search and fare verification through the official Atlas Flight Booking
CLI, sandbox only. Search and verify are both live-verified. There is no order,
payment or ticketing path in this application, and `ticketing_available: true`
from the account is treated as a capability, not an authorisation.

## Qoder usage

**None.** See `docs/JUDGING_RUBRIC_AUDIT.md` — this is a known scoring risk and
has not been papered over.

## Known limitations

* The Tokyo journey is a deterministic demo scenario. Atlas Sandbox serves a
  bounded route set and does not carry it, so the provider proof runs on
  HKG → MNL. This is stated on screen, not just in narration.
* Research is recorded for the demo. Live research measured 54–76 seconds with
  timeouts — too slow and too unreliable for a three-minute video.
* Price-change and unavailable branches are proven against Atlas-shaped fixtures.
  The real verification returned *unchanged*, and manufacturing a change would
  mean spamming the provider.
* No booking, payment or ticketing.

## Deployment status

Not deployed. See `docs/DEPLOYMENT_PLAN.md`. The application runs with zero
credentials, so deployment carries no secret-management risk.

## YouTube link

`[TO BE ADDED BY FOUNDER]`
