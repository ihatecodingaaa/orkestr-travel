# Demo Script

**Status:** `IMPLEMENTED` for the local build. Every screen below exists and
runs offline with `npm run dev`.

**The `/demo` trip is entirely LOCAL FIXTURE data.** No airline, no web search,
no model. The provenance board at the top of every screen says so per subsystem,
permanently, and is not a tooltip.

Phase 6 adds two screens that are NOT part of the fixture trip: `/understand`
and `/research`. With no Model Studio credential they replay recorded data and
label it as recorded. With a credential they call the live service, and the
flight row on the board still reads `Local fixture`, because Phase 6 connected
no airline.

---

## Before you start

```bash
npm install
npm run dev          # http://localhost:3000
```

The demo is driven by the URL, so every step is a real navigation and the back
button works as undo. Any point can be reached directly if something goes wrong:

| Step | Address |
| --- | --- |
| Baseline | `/demo` |
| After Ryan joins | `/demo/waves?stage=RYAN_JOINED` |
| Fare rise past a preference | `/demo/journey?stage=RYAN_JOINED&fare=SOFT_BREACH` |
| Fare rise past a hard limit | `/demo/journey?stage=RYAN_JOINED&fare=HARD_BREACH` |
| A private view | `/demo/participant/T-006?stage=RYAN_JOINED&fare=SOFT_BREACH` |
| Reading a group chat | `/understand` |
| The evidence layer | `/research` |

The same address always produces the same screen. Nothing is random and nothing
reads a clock.

---

## The three-minute sequence

### 0:00 - The problem (20 seconds)

Open `/`.

> "Six people want five days in Tokyo. They live in different places, they are
> free on different days, one of them needs step-free access and travels with her
> husband. The usual answer is a group chat that never resolves."

Point at the disabled text box.

> "Reading free text isn't built yet, so this build says so rather than
> pretending. Everything here comes from a structured demo fixture."

Click **Load the family demo**.

### 0:20 - Who is going (25 seconds)

`/demo`

> "Six of seven expected travellers have joined. Notice what the group can see:
> that somebody has a budget requirement, not what it says. Personal figures stay
> with their owner."

Point at Gita's card.

> "She has stated she needs step-free access. Two separate badges: she has
> confirmed the requirement, and the airline has confirmed nothing. Those are
> different facts and the interface never merges them."

### 0:45 - The split (40 seconds)

`/demo/waves` - **the signature screen.**

> "One flight doesn't work for everyone. So Orkestr doesn't give up; it finds the
> smallest split that does."

```
Wave A   Tue 25 Aug   Ama, Bo, Cai
Wave B   Wed 26 Aug   Gita, Elias, Nadia
         Everyone together from Wed 26 Aug, 17:00
```

> "Gita and Elias are together because she said she needs to be with him. Not
> because they share a surname."

Point at **Why this works**.

> "Every line is derived from the planning result, not written by a model. Two
> groups rather than three. Everyone together within 24 hours. And one line
> that's still open: the airline hasn't confirmed the assistance."

Scroll to the return leg.

> "And they don't all come home together. The return is planned separately, so
> the two groups fly out and one group flies back."

### 1:25 - The whole journey (30 seconds)

`/demo/journey`

> "Day one only has three people on it, and the interface says so. Nothing for
> the whole group is scheduled before everybody has landed."

Point at a demo-assumption label.

> "Airport timings are labelled as demo assumptions, because how early you need
> to arrive genuinely varies. We're not going to invent a number and present it
> as an airline rule."

### 1:55 - Ryan joins (35 seconds)

Click **Ryan joins**.

> "Ryan joins after all of this was agreed. Watch what does NOT happen."

```
Wave A   unchanged
Wave B   + Ryan, same flight
10 of 10 existing flight decisions stayed intact
1 new decision was added
```

> "Wave A is untouched. Those three people are never asked anything. Ten of ten
> existing decisions survived, and one was added for Ryan."

> "And it says Wave B needs re-checking. Ryan fits that flight's requirements.
> Whether a seat exists, nobody has checked, and we don't claim otherwise."

### 2:30 - The fare moves (20 seconds)

Click **Check the fares**.

> "The fare went up by thirty dollars. That crosses one traveller's preferred
> budget."

> "The group is told that one traveller would need to stretch a preference. It is
> not told who, and it is not told the number."

Open the private view.

> "Only she sees this: thirty dollars above her preferred budget, four-thirty
> normally, four-sixty for this trip. And her usual preference is not changed by
> accepting. It's recorded as an exception, not an overwrite."

### 2:50 - What still needs a person (10 seconds)

`/demo/decisions`

> "Orkestr prepared thirty-two journey items. Seven things still need a human or
> an airline. That's the product: it absorbs the complexity and hands back the
> decisions."

---

## Two more minutes: what Phase 6 added

Both screens below stand apart from the fixture trip on purpose. There is no
persistence in this build, so a live extraction has nowhere to be kept, and
wiring it into the demo trip would mean inventing a session store. Fake
persistence pretending to be real state is exactly the kind of thing this
product is built not to do. Say so out loud; it lands better than hiding it.

### Reading a group chat

`/understand`

The box is pre-filled with a fictional family discussion. Press **Read this**.

> "Seven people and six requirements, out of a conversation nobody filled a form
> for. Every line shows the words it came from, because a machine's reading of
> your own words is not something you should have to take on trust."

Point at the two ambiguities:

> "It noticed that 'direct is better' could be a requirement or a preference,
> and that Ryan hasn't replied. It asks about those two things and nothing else,
> because those are the only two where the answer changes the plan."

Then the most important sentence in the demo:

> "Nothing here is confirmed. A model may propose a requirement; only the person
> it belongs to can make it binding. That is not a prompt asking nicely — the
> validator refuses a response that even contains a confirmation field."

If the build has no credential, the board says **Demo fixture extraction** and
the screen says the reading is recorded. Do not describe it as live. It is a
recorded reading, replayed through the same validation pipeline a live one goes
through, and saying so is more impressive than the alternative.

### The evidence layer

`/research`

Press **Run the research**.

> "One bounded question: something a group of seven with a stated step-free
> requirement can do together. Not 'research Tokyo' — a typed question with a
> source limit and a deadline, so the spend and the claim are both bounded."

Scroll to the sources, then to the claims:

> "Two sources disagree about whether the pier can be reached without steps. We
> show both and say we have not picked one. And this claim" — the lift one —
> "came only from a forum post, so it is labelled as what visitors said and not
> as an operational fact. Ten reviews saying step-free are ten people's
> experience. They are not the operator."

Then the rejected citation:

> "The model cited a page no search returned. We rejected it. There is no way to
> tell a real citation from an invented one by looking at it, so the only safe
> test is whether we actually retrieved that page."

---

## Demo resilience

What each beat actually depends on. The point of the table is that the
credential-dependent beats are the last two, and both degrade to a labelled
fixture rather than to a broken screen.

| Beat | Domain only | Needs Qwen | Needs web | Needs Atlas | If the dependency is missing |
| --- | --- | --- | --- | --- | --- |
| The problem (`/`) | yes | no | no | no | n/a |
| The group (`/demo`) | yes | no | no | no | n/a |
| Travel waves | yes | no | no | no | n/a |
| Reunion boundary | yes | no | no | no | n/a |
| Ryan joins | yes | no | no | no | n/a |
| Decisions preserved | yes | no | no | no | n/a |
| Fare shock | yes | no | no | no | n/a |
| Journey package | yes | no | no | no | n/a |
| Needs attention | yes | no | no | no | n/a |
| Understanding (`/understand`) | no | optional | no | no | Replays a fixture reading, labelled as one |
| Research (`/research`) | no | optional | optional | no | Replays fixture evidence, labelled as one |
| Real flight availability | no | no | no | **yes** | Not built. Flights are a local fixture and say so |

**Nine of the eleven built beats need nothing external.** They run with the
network switched off, and they are the beats carrying the product argument: the
split, the reunion, the late join, the preserved decisions, the fare shock.

The two Phase 6 screens are additive. With no credential they demonstrate the
same shapes from fixture data and label it accurately; with one they go live and
the flight row still reads `Local fixture`.

**There is no automatic fallback from live to fixture.** If a live call fails
mid-demo it fails visibly, with its own message. Substituting a fixture under a
live label would be the one failure nobody in the room could detect, which is
precisely why it does not happen. Rehearse saying "that call failed, here is the
fixture path" — it is a better moment than pretending.

---

## What a judge should take away

1. **It doesn't give up.** No single flight works, so it finds the smallest split
   that does.
2. **It changes as little as possible.** A late joiner costs three people
   nothing.
3. **It never overstates.** Nothing is booked, nothing is verified, no seat is
   claimed, and assistance is not confirmed just because somebody asked for it.
4. **Privacy is structural.** The group learns the effect; only the owner learns
   the detail.
5. **No feasibility decision is made by AI.** Qwen reads language and gathers
   evidence. Whether 08:40 satisfies "not before 09:00" is a pure function with
   unit tests, and a test fails the build if any file in the core so much as
   names a model provider.
6. **The provenance is per subsystem.** Understanding can be live while the
   flights are still a fixture, and the board says exactly that. One global
   "live" badge would be the easiest lie available, so the single banner was
   deleted rather than left lying around.

---

## What is NOT in this demo

Real flights. Real prices. Real availability. Any airline. Any account or login.
Any saved data. Any booking or payment.

**And, unless a credential has been added:** any live model call and any live web
search. The understanding and research screens replay recorded data and label it
as recorded. Adding a Model Studio key to `.env.local` switches them to live and
changes the labels; it changes no other code.

**Never say "live" about a screen showing a recorded label.** If somebody asks
whether it is really calling Qwen, the honest answer is worth more than the
impressive one, and the labels on screen will contradict you anyway.

A later phase replaces the fixture flight provider with Atlas. Until then, the
board tells the truth on every screen.

## Which mode to demo in (decide before you start, not on stage)

`MODEL_STUDIO_MODE` controls this. It defaults to `disabled`, and a credential
alone cannot switch it on.

| Segment | Mode to use | Why |
|---|---|---|
| Understanding what a group said | `live` | ~10s, reliable across 38 live calls. Show it live. |
| Reading a link someone pasted | `live` | 15-17s, reliable. The refusal case is the better demo. |
| Web research with evidence | **`recorded`** | Live succeeds in about half of runs and takes ~55s when it does. |

**Do not demo live research on stage.** Three of six live attempts exceeded 120s,
and the cause is not fixable by waiting: `web_extractor` requires thinking mode,
and thinking mode is the latency. The recorded fallback in
`adapters/fixture/researchFixtures.ts` is transcribed from a real successful run,
so it shows genuine sources and a genuine conflict -- it is a recording of the
truth, not a mock-up of it.

Say so out loud when you switch. The interface labels recorded results as
`RECORDED_WEB` and never as live; claiming otherwise would be the one thing this
whole architecture is built to prevent, and an audience that catches it stops
believing everything else.

### The strongest 90 seconds

1. **Paste a TikTok link that cannot be read**, with a note like "the night
   market bit". It returns nothing. No interest is proposed, and the note is
   kept. Point out that the system had a plausible hint available and declined
   to use it -- most systems would have shown "night market food" here.
2. **Show the accessibility conflict** in the recorded research: the city's
   official record says four accessible restrooms, a community review counts
   five. Both are shown, both flagged for confirmation, neither averaged away.
3. **Point at a community source claiming an operational fact.** It is
   downgraded to a community signal automatically. A forum post cannot tell you
   a venue is step-free.

All three are refusals. That is the product.

### The entity-binding beat (Phase 6.7)

Worth thirty seconds if the room is technical, because it is the least obvious
thing the product does.

Researching Hamarikyu Gardens returned the city's **official** accessibility
page for Shiodome Station, next door. Real page, real citation, true statement:
three lifts, one accessible restroom.

It does not clear the garden's step-free requirement, and the screen still says
*"No official source confirmed the access this group needs."*

Say why: every integrity signal on that claim is green. Official source. Genuine
citation. Not conflicting. The only thing wrong with it is that it is about
somewhere else -- and a planner who trusted it would send someone who uses a
wheelchair to a garden nobody had checked.

**The demo-mode policy has not changed.** Live research still succeeds in about
half of runs (54-76s when it works, >120s when it does not), and this run took
76.6s. Show this from the recorded fallback, not live.

## Atlas, as things actually stand (Phase 7)

**Do not promise a live Atlas search on stage.** Not because it is slow -- that
is the Model Studio problem -- but because as of the end of Phase 7 **no
authorised Atlas call has been made**. Authorization is a browser step nobody
has completed on this machine.

Until it is, the flight row says `LOCAL_FIXTURE`, and that is the truth.

### After the two human steps in `EXTERNAL_SETUP.md`

If a real sandbox search succeeds, the beat is worth showing:

1. Orkestr determines two Travel Waves from confirmed availability.
2. Atlas Sandbox returns provider-backed offers for each wave.
3. **Orkestr** picks the compatible candidate -- not Atlas's first result.
4. Atlas re-checks that one offer.
5. The screen shows what came back: verified, changed, or gone.

**Say "sandbox" out loud, every time.** Sandbox fares are test data. Every label
in the UI already contains the word; the narration should match it. Calling a
sandbox fare a real price is the one claim that would be both easy to make and
impossible to defend.

### The line worth landing

Searching is not holding. Orkestr can find a fare and re-check it; it creates no
order and reserves no seat, and the provider-capacity row says so on every
screen regardless of what else went live.

## Atlas after the live closeout (22 August 2026)

**The flight row still says `LOCAL_FIXTURE`, and that is still the truth.**

Authorization is complete and the sandbox switch is proven live, but Atlas
Sandbox search itself returns `INTERNAL_ERROR` server-side on every route tried,
including Atlas's own documented example. No offer has ever been retrieved, so
there is no recorded Atlas Sandbox fixture and none has been invented.

**Demo mode decision: LOCAL FIXTURE.** Not by preference -- by the only honest
option available.

If someone asks about the Atlas integration on stage, the truthful and
genuinely interesting answer is: it is built, it proves it is pointed at the
sandbox before every single call, it cannot express the production environment
at all, and it refuses to show anything when the provider fails. The last part
is currently on display whether we like it or not.

## Atlas is live-verified (Phase 7 closed)

The whole provider path works against the real Atlas Sandbox: authorization,
sandbox switch, search, normalisation and verification.

**Stage mode: RECORDED ATLAS SANDBOX.** Not because live is slow -- the whole
path is about 8 seconds -- but because live Sandbox offers **expire in roughly
fifteen minutes**, and a demo that searches during setup and verifies on stage
will show an expired offer to an audience. The recording came from a real
verified run and replays through the same parser.

Say "sandbox" out loud. Sandbox fares are test data, they cannot be bought, and
every label in the UI already contains the word.

### The route problem, stated honestly

Atlas Sandbox has a **bounded test dataset**. HKG-MNL works. SIN-NRT and KUL-SIN
return `INTERNAL_ERROR`. The Tokyo family story does not have a Sandbox-backed
flight path, and pretending otherwise would be the one claim on stage that a
judge could disprove by asking a single follow-up question.

**Recommendation: keep the Tokyo hero story, and show Atlas as a separate,
clearly-labelled provider segment on HKG-MNL.** Reasoning:

* The story is the product. Travel Waves, compromise and repair are what make
  this different, and none of them depend on which airports Atlas happens to
  stock.
* Rewriting the hero to Hong Kong to Manila would buy one end-to-end line and
  cost the group narrative the whole demo is built on.
* A thirty-second "and here is that same pipeline against a real provider" beat
  is more credible than a seamless story nobody can verify, because it shows the
  seam rather than hiding it.

Phase 8 owns the final end-to-end hero integration and can revisit this with the
full agent loop in hand.

### The beat, if you show it

1. Orkestr proves it is pointed at the sandbox -- **before every single call**,
   because Atlas defaults to production and offers no way to read the current
   environment.
2. Search returns two offers: one direct, one connecting via Seoul.
3. **Orkestr** picks the candidate. Not Atlas's first result.
4. Atlas re-checks that one offer; the screen shows verified, changed or gone.

The line worth landing: searching is not holding. Orkestr can find a fare and
re-check it. It creates no order and reserves no seat, and the provider-capacity
row says so on every screen regardless of what else went live.

## The three-minute run (Phase 8)

**Opening line:** *"Most travel planners re-plan the trip. Orkestr works out what
actually changed."*

**Closing line:** *"Travel together, even when you can't travel the same way."*

### The sequence

| Time | Screen | What to say |
|---|---|---|
| 0:00–0:20 | `/understand` | Seven people, one group chat, nobody free on the same day. |
| 0:20–0:40 | `/understand` | What Orkestr understood. Proposals still say *proposed*. |
| 0:40–1:00 | `/demo/waves` | One flight does not work. Two travel groups, from confirmed availability — not from a model's opinion. |
| 1:00–1:20 | `/demo/journey` | The whole trip, including the reunion. Group things sit after everyone lands. |
| 1:20–1:35 | `/demo/agent` (provider card) | A real flight provider, searched and then **re-checked**. |
| 1:35–1:55 | `?stage=RYAN_JOINED` | Ryan joins after everything was agreed. |
| 1:55–2:20 | `/demo/agent` | **What changed. What it affected. What stayed exactly as it was.** |
| 2:20–2:40 | `?fareScenario=SOFT_BREACH` → `/demo/participant/...` | The fare moves. One person is asked, privately. |
| 2:40–2:55 | `/demo/agent` | 10 of 10 earlier decisions kept, 1 new one added. 0 rebuilds. 5 of 7 steps. |
| 2:55–3:00 | — | Closing line. |

### What each label on screen actually means

Every claim maps to something implemented. Nothing below is presenter fiction.

| Label | What it is |
|---|---|
| **LIVE MODEL STUDIO** | A real Qwen call. Verified live; ~10s. |
| **RECORDED MODEL STUDIO** | A real research result captured earlier. Use this on stage — live research took 54–76s with timeouts. |
| **RECORDED ATLAS SANDBOX** | A real Atlas Sandbox search + verify from 22 Aug 2026. Sandbox fares are **test data**. |
| **DEMO SCENARIO** | The Tokyo flights. Deterministic fixtures, not provider data. |
| **DETERMINISTIC** | Constraints, waves, repair, preservation. No model involved. |

### The seam, said out loud

The Tokyo trip is the product story. The Atlas proof is on **HKG → MNL**, because
Atlas Sandbox serves a bounded set of test routes and does not carry Tokyo.

**Say that.** It takes one sentence — *"the provider proof runs on a route the
sandbox actually serves"* — and it is far stronger than a seamless story a judge
could puncture with one follow-up question. The agent screen says it in writing
too, so the claim survives without narration.

### Do not

* Do not run live research on stage. 54–76s, with timeouts observed.
* Do not animate "Searching Atlas live…" over a recording.
* Do not say "real fares". Sandbox is test data and nothing is booked.
* Do not claim a live price change. The real verification returned **unchanged**;
  the fare-shock beat is a labelled demo scenario.
